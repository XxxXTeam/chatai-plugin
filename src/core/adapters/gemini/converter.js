import crypto from 'node:crypto'
import { registerFromChaiteConverter, registerFromChaiteToolConverter, registerIntoChaiteConverter } from '../../utils/converter.js'

/**
 * Convert Chaite IMessage to Gemini format
 */
registerFromChaiteConverter('gemini', (source) => {
    switch (source.role) {
        case 'assistant': {
            const parts = []

            // Add text content
            const textContent = source.content
                .filter(t => t.type === 'text')
                .map(t => ({ text: t.text }))

            parts.push(...textContent)

            // Add function calls if present
            if (source.toolCalls && source.toolCalls.length > 0) {
                for (const toolCall of source.toolCalls) {
                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args: toolCall.function.arguments,
                        },
                    })
                }
            }

            return {
                role: 'model',
                parts,
            }
        }
        case 'user': {
            const parts = source.content.map(t => {
                switch (t.type) {
                    case 'text':
                        return { text: t.text }
                    case 'image':
                        // Gemini expects inline data format
                        // 注：URL图片已在GeminiClient中预处理为base64
                        if (t.image?.startsWith('data:')) {
                            const [mimeType, base64Data] = t.image.split(';base64,')
                            return {
                                inlineData: {
                                    mimeType: mimeType.replace('data:', ''),
                                    data: base64Data,
                                },
                            }
                        } else if (t.image) {
                            // Base64 without data URL prefix
                            return {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: t.image,
                                },
                            }
                        }
                        return { text: '[图片]' }
                    case 'video':
                        // Gemini 支持视频的 inlineData 格式
                        if (t.video?.startsWith('data:')) {
                            const [mimeType, base64Data] = t.video.split(';base64,')
                            return {
                                inlineData: {
                                    mimeType: mimeType.replace('data:', ''),
                                    data: base64Data,
                                },
                            }
                        } else if (t.video) {
                            return {
                                inlineData: {
                                    mimeType: t.mimeType || 'video/mp4',
                                    data: t.video,
                                },
                            }
                        }
                        return { text: '[视频]' }
                    case 'video_info':
                        // 视频信息类型，如果已转为base64
                        if (t.video?.startsWith('data:')) {
                            const [mimeType, base64Data] = t.video.split(';base64,')
                            return {
                                inlineData: {
                                    mimeType: mimeType.replace('data:', ''),
                                    data: base64Data,
                                },
                            }
                        }
                        // 否则只返回文本描述
                        return { text: `[视频: ${t.url || t.name || ''}]` }
                    case 'audio':
                    case 'record':
                        // 音频处理
                        if (t.data?.startsWith?.('data:')) {
                            const [mimeType, base64Data] = t.data.split(';base64,')
                            return {
                                inlineData: {
                                    mimeType: mimeType.replace('data:', ''),
                                    data: base64Data,
                                },
                            }
                        } else if (t.data) {
                            return {
                                inlineData: {
                                    mimeType: `audio/${t.format || 'mp3'}`,
                                    data: t.data,
                                },
                            }
                        }
                        return { text: '[语音]' }
                    case 'file':
                        // 文件类型转为文本描述
                        return { text: `[文件: ${t.name || t.file || ''}]` }
                    default:
                        return { text: '' }
                }
            }).filter(p => p.text !== '' || p.inlineData)

            return {
                role: 'user',
                parts,
            }
        }
        case 'tool': {
            // Gemini expects function responses as user messages with functionResponse parts
            return source.content.map(tcr => ({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: tcr.name,
                        response: {
                            content: tcr.content,
                        },
                    },
                }],
            }))
        }
        default: {
            throw new Error(`Unknown role: ${source.role}`)
        }
    }
})

/**
 * Convert Gemini format to Chaite IMessage
 */
registerIntoChaiteConverter('gemini', (response) => {
    const candidate = response.candidates?.[0]
    if (!candidate) {
        throw new Error('No candidate in response')
    }

    const content = []
    const toolCalls = []

    // Process parts
    for (const part of candidate.content.parts) {
        if (part.text) {
            content.push({
                type: 'text',
                text: part.text,
            })
        }
        if (part.functionCall) {
            toolCalls.push({
                id: crypto.randomUUID(),
                type: 'function',
                function: {
                    name: part.functionCall.name,
                    arguments: part.functionCall.args,
                },
            })
        }
    }

    return {
        role: 'assistant',
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
})

/**
 * Convert Chaite Tool to Gemini format
 */
registerFromChaiteToolConverter('gemini', (tool) => {
    return {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }
})

export { }
