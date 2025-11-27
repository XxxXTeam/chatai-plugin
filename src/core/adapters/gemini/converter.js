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
                        if (t.image.startsWith('data:')) {
                            const [mimeType, base64Data] = t.image.split(';base64,')
                            return {
                                inlineData: {
                                    mimeType: mimeType.replace('data:', ''),
                                    data: base64Data,
                                },
                            }
                        } else if (t.image.startsWith('http')) {
                            // URL-based images
                            return {
                                fileData: {
                                    fileUri: t.image,
                                },
                            }
                        } else {
                            // Base64 without data URL prefix
                            return {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: t.image,
                                },
                            }
                        }
                    case 'audio':
                        return {
                            inlineData: {
                                mimeType: `audio/${t.format || 'mp3'}`,
                                data: t.data,
                            },
                        }
                    default:
                        return { text: '' }
                }
            })

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
