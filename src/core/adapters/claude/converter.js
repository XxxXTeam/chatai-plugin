import crypto from 'node:crypto'
import { registerFromChaiteConverter, registerFromChaiteToolConverter, registerIntoChaiteConverter } from '../../utils/converter.js'

/**
 * Convert Chaite IMessage to Claude format
 */
registerFromChaiteConverter('claude', (source) => {
    switch (source.role) {
        case 'assistant': {
            const content = []

            // Add text content
            for (const part of source.content) {
                if (part.type === 'text') {
                    content.push({
                        type: 'text',
                        text: part.text,
                    })
                }
            }

            // Add tool use if present
            if (source.toolCalls && source.toolCalls.length > 0) {
                for (const toolCall of source.toolCalls) {
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: toolCall.function.arguments,
                    })
                }
            }

            return {
                role: 'assistant',
                content,
            }
        }
        case 'user': {
            const content = source.content.map(t => {
                switch (t.type) {
                    case 'text':
                        return {
                            type: 'text',
                            text: t.text,
                        }
                    case 'image': {
                        // Claude expects base64 images with media type
                        let source_data
                        let media_type = 'image/jpeg'

                        if (t.image.startsWith('data:')) {
                            const [mimeType, base64Data] = t.image.split(';base64,')
                            media_type = mimeType.replace('data:', '')
                            source_data = base64Data
                        } else if (t.image.startsWith('http')) {
                            // Claude doesn't support URL images directly, skip for now
                            // In production, we'd need to download and convert
                            return {
                                type: 'text',
                                text: '[Image URL not supported by Claude]',
                            }
                        } else {
                            source_data = t.image
                        }

                        return {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type,
                                data: source_data,
                            },
                        }
                    }
                    default:
                        return {
                            type: 'text',
                            text: '',
                        }
                }
            })

            return {
                role: 'user',
                content,
            }
        }
        case 'tool': {
            // Claude expects tool results as user messages with tool_result content
            const content = source.content.map(tcr => ({
                type: 'tool_result',
                tool_use_id: tcr.tool_call_id,
                content: tcr.content,
            }))

            return {
                role: 'user',
                content,
            }
        }
        default: {
            throw new Error(`Unknown role: ${source.role}`)
        }
    }
})

/**
 * Convert Claude format to Chaite IMessage
 */
registerIntoChaiteConverter('claude', (response) => {
    const content = []
    const toolCalls = []

    // Process content blocks
    for (const block of response.content) {
        if (block.type === 'text') {
            content.push({
                type: 'text',
                text: block.text,
            })
        }
        if (block.type === 'tool_use') {
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: block.input,
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
 * Convert Chaite Tool to Claude format
 */
registerFromChaiteToolConverter('claude', (tool) => {
    return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
    }
})

export { }
