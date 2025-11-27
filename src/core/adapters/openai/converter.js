import { registerFromChaiteConverter, registerFromChaiteToolConverter, registerIntoChaiteConverter } from '../../utils/converter.js'

/**
 * Convert Chaite IMessage to OpenAI format
 */
registerFromChaiteConverter('openai', (source) => {
    switch (source.role) {
        case 'assistant': {
            const text = source.content
                .filter(t => t.type === 'text')
                .map(t => t.text)
                .join('')

            return {
                role: 'assistant',
                content: text || undefined,
                tool_calls: (source.toolCalls && source.toolCalls.length > 0) ? source.toolCalls.map(t => ({
                    id: t.id,
                    type: t.type,
                    function: {
                        arguments: JSON.stringify(t.function.arguments),
                        name: t.function.name,
                    },
                })) : undefined,
            }
        }
        case 'user': {
            // Check if content is simple text only (for better compatibility with proxy APIs)
            const hasOnlyText = source.content.every(t => t.type === 'text')
            const isSingleText = source.content.length === 1 && source.content[0].type === 'text'

            // For simple text-only messages, use string format for better compatibility
            if (isSingleText) {
                return {
                    role: 'user',
                    content: source.content[0].text
                }
            }

            // For multimodal content or multiple text items, use array format
            return {
                role: 'user',
                content: source.content.map(t => {
                    switch (t.type) {
                        case 'text':
                            return { type: 'text', text: t.text }
                        case 'audio':
                            return {
                                type: 'input_audio',
                                input_audio: { data: t.data, format: t.format },
                            }
                        case 'image':
                            return {
                                type: 'image_url',
                                image_url: { url: t.image.startsWith('http') ? t.image : `data:image/jpeg;base64,${t.image}` },
                            }
                    }
                }),
            }
        }
        case 'tool': {
            return source.content.map(tcr => ({
                role: 'tool',
                tool_call_id: tcr.tool_call_id,
                content: tcr.content,
            }))
        }
        default: {
            throw new Error('Unknown type')
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

            const contents = content.map(t => ({
                type: 'text',
                text: t.type === 'text' ? t.text : t.refusal || '',
            }))

            return {
                role: 'assistant',
                content: contents,
                toolCalls: msg.tool_calls?.map(t => ({
                    id: t.id,
                    type: 'function',
                    function: {
                        name: t.function.name,
                        arguments: JSON.parse(t.function.arguments),
                    },
                })),
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
