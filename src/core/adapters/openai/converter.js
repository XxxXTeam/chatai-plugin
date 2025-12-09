import { registerFromChaiteConverter, registerFromChaiteToolConverter, registerIntoChaiteConverter } from '../../utils/converter.js'

/**
 * Convert Chaite IMessage to OpenAI format
 */
registerFromChaiteConverter('openai', (source) => {
    switch (source.role) {
        case 'assistant': {
            // Handle null/undefined content safely
            const content = source.content || []
            const text = Array.isArray(content) 
                ? content.filter(t => t && t.type === 'text').map(t => t.text).join('')
                : ''

            const hasToolCalls = source.toolCalls && source.toolCalls.length > 0

            // Build the message object
            const msg = {
                role: 'assistant',
                // 重要：有 tool_calls 时，content 应为 null 而不是空字符串
                // 某些 API（如 Gemini）在 content 为空字符串时可能无法正确处理
                content: text || (hasToolCalls ? null : ''),
            }

            // Only add tool_calls if present
            if (hasToolCalls) {
                msg.tool_calls = source.toolCalls.map(t => {
                    const toolCall = {
                        id: t.id,
                        type: t.type || 'function',
                        function: {
                            arguments: typeof t.function.arguments === 'string' 
                                ? t.function.arguments 
                                : JSON.stringify(t.function.arguments),
                            name: t.function.name,
                        },
                    }
                    // 保留 Gemini thought_signature（OpenAI 兼容模式）
                    if (t.thought_signature || t.extra_content?.google?.thought_signature) {
                        toolCall.extra_content = {
                            google: {
                                thought_signature: t.thought_signature || t.extra_content.google.thought_signature
                            }
                        }
                    }
                    return toolCall
                })
            }

            return msg
        }
        case 'user': {
            // Handle null/undefined content
            const userContent = source.content || []
            if (!Array.isArray(userContent) || userContent.length === 0) {
                return { role: 'user', content: '' }
            }
            
            // Check if content is simple text only (for better compatibility with proxy APIs)
            const hasOnlyText = userContent.every(t => t.type === 'text')
            const isSingleText = userContent.length === 1 && userContent[0].type === 'text'

            // For simple text-only messages, use string format for better compatibility
            if (isSingleText) {
                return {
                    role: 'user',
                    content: userContent[0].text
                }
            }

            // For multimodal content or multiple text items, use array format
            return {
                role: 'user',
                content: userContent.map(t => {
                    switch (t.type) {
                        case 'text':
                            return { type: 'text', text: t.text }
                        case 'audio':
                            return {
                                type: 'input_audio',
                                input_audio: { data: t.data, format: t.format },
                            }
                        case 'image':
                            // 支持base64和URL
                            return {
                                type: 'image_url',
                                image_url: { 
                                    url: t.image.startsWith('http') || t.image.startsWith('data:') 
                                        ? t.image 
                                        : `data:image/jpeg;base64,${t.image}` 
                                },
                            }
                        case 'image_url':
                            // 直接传递 image_url 类型（来自 messageParser）
                            return {
                                type: 'image_url',
                                image_url: { url: t.image_url?.url || t.url || '' }
                            }
                        case 'video_info':
                            // 视频信息转为文本描述（大多数API不支持视频）
                            return {
                                type: 'text',
                                text: `[视频${t.name ? ':' + t.name : ''} URL:${t.url || ''}]`
                            }
                        default:
                            // 未知类型跳过
                            console.warn('[OpenAI Converter] 未知的content类型:', t.type)
                            return null
                    }
                }).filter(Boolean),  // 过滤掉null
            }
        }
        case 'tool': {
            const toolMsgs = source.content.map(tcr => {
                console.log('[OpenAI Converter] tool消息转换:', {
                    原始tool_call_id: tcr.tool_call_id,
                    content长度: tcr.content?.length
                })
                return {
                    role: 'tool',
                    tool_call_id: tcr.tool_call_id,
                    content: tcr.content,
                }
            })
            return toolMsgs
        }
        case 'system': {
            // Handle system messages
            const systemContent = source.content || []
            const systemText = Array.isArray(systemContent)
                ? systemContent.filter(t => t && t.type === 'text').map(t => t.text).join('\n')
                : (typeof systemContent === 'string' ? systemContent : '')
            return {
                role: 'system',
                content: systemText
            }
        }
        case 'developer': {
            // Handle developer messages (for thinking models)
            const devContent = source.content || []
            const devText = Array.isArray(devContent)
                ? devContent.filter(t => t && t.type === 'text').map(t => t.text).join('\n')
                : (typeof devContent === 'string' ? devContent : '')
            return {
                role: 'developer',
                content: devText
            }
        }
        default: {
            throw new Error(`Unknown role: ${source.role}`)
        }
    }
})

/**
 * Convert OpenAI format to Chaite IMessage
 */
registerIntoChaiteConverter('openai', (msg) => {
    switch (msg.role) {
        case 'assistant': {
            const content = msg.content ? (Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }]) : []

            const contents = []
            
            // 处理 reasoning_content 字段（思考内容）
            if (msg.reasoning_content) {
                contents.push({
                    type: 'reasoning',
                    text: msg.reasoning_content
                })
            }
            
            // 处理普通 content
            contents.push(...content.map(t => {
                let text = t.type === 'text' ? t.text : t.refusal || ''
                // 去除首行换行符（某些模型会在回复开头添加换行）
                if (typeof text === 'string') {
                    text = text.replace(/^[\r\n]+/, '')
                }
                return { type: 'text', text }
            }))

            // 安全解析 tool_calls
            let toolCalls = undefined
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                toolCalls = msg.tool_calls.map(t => {
                    let args = t.function?.arguments
                    // 安全解析 arguments
                    if (typeof args === 'string') {
                        try {
                            args = JSON.parse(args)
                        } catch (e) {
                            console.warn('[OpenAI Converter] 解析 arguments 失败:', args, e.message)
                            args = {}
                        }
                    } else if (!args) {
                        args = {}
                    }
                    const toolCall = {
                        id: t.id,
                        type: 'function',
                        function: {
                            name: t.function?.name,
                            arguments: args,
                        },
                    }
                    // 保留 Gemini thought_signature（OpenAI 兼容模式）
                    // 这对于 Gemini 3 Pro 模型是必须的
                    if (t.extra_content?.google?.thought_signature) {
                        toolCall.thought_signature = t.extra_content.google.thought_signature
                        toolCall.extra_content = t.extra_content
                    }
                    return toolCall
                })
            }

            return {
                role: 'assistant',
                content: contents,
                toolCalls,
            }
        }
        case 'user': {
            if (typeof msg.content === 'string') {
                return {
                    role: 'user',
                    content: [{ type: 'text', text: msg.content }],
                }
            }
            return {
                role: 'user',
                content: msg.content?.map(t => {
                    switch (t.type) {
                        case 'image_url':
                            return { type: 'image', image: t.image_url.url }
                        case 'text':
                            return { type: 'text', text: t.text }
                        case 'input_audio':
                            return { type: 'audio', data: t.input_audio.data, format: t.input_audio.format || 'mp3' }
                    }
                }),
            }
        }
        case 'system': {
            return {
                role: 'system',
                content: typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content?.map(t => ({
                    type: 'text',
                    text: t.text,
                })),
            }
        }
        case 'tool': {
            return {
                role: 'tool',
                content: [{
                    type: 'tool',
                    tool_call_id: msg.tool_call_id,
                    content: typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || '',
                }],
            }
        }
        case 'developer': {
            return {
                role: 'developer',
                content: typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content?.map(t => ({
                    type: 'text',
                    text: t.text,
                })),
            }
        }
        default: {
            throw new Error('not implemented yet')
        }
    }
})

/**
 * Convert Chaite Tool to OpenAI format
 */
registerFromChaiteToolConverter('openai', (tool) => {
    return {
        type: 'function',
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
        },
    }
})

export { }
