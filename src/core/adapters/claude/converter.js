import crypto from 'node:crypto'
import {
    registerFromChaiteConverter,
    registerFromChaiteToolConverter,
    registerIntoChaiteConverter
} from '../../utils/converter.js'
import { toClaudeTool } from '../tooling.js'

function parseToolInput(input) {
    if (input === undefined || input === null) return {}
    if (typeof input !== 'string') return input
    try {
        const parsed = JSON.parse(input)
        return parsed && typeof parsed === 'object' ? parsed : { value: parsed }
    } catch {
        return { input }
    }
}

/**
 * 将内部 MCP 内容块转换为 Claude tool_result 可消费内容。
 * @param {Object} block - MCP 内容块
 * @returns {Object} Claude 内容块
 */
function toClaudeToolResultBlock(block) {
    if (!block || typeof block !== 'object') return { type: 'text', text: String(block ?? '') }
    if (block.type === 'text') return { type: 'text', text: String(block.text || '') }
    if (block.type === 'image' && block.data) {
        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type: block.mimeType || 'image/png',
                data: block.data
            }
        }
    }
    if (block.type === 'resource' && typeof block.resource?.text === 'string') {
        return { type: 'text', text: `[资源 ${block.resource.uri || ''}]\n${block.resource.text}` }
    }
    if (block.type === 'resource_link') {
        return { type: 'text', text: `[资源链接 ${block.name || ''} ${block.uri || ''}]` }
    }
    if (block.type === 'audio') {
        return { type: 'text', text: `[音频 mimeType=${block.mimeType || 'unknown'}]` }
    }
    return { type: 'text', text: `[MCP 内容块 type=${block.type || 'unknown'}]` }
}

/**
 * Convert Chaite IMessage to Claude format
 */
registerFromChaiteConverter('claude', source => {
    switch (source.role) {
        case 'assistant': {
            const content = []

            if (Array.isArray(source.content)) {
                for (const part of source.content) {
                    if (part.type === 'text') {
                        content.push({
                            type: 'text',
                            text: part.text
                        })
                    }
                }
            }

            if (source.toolCalls && source.toolCalls.length > 0) {
                for (const toolCall of source.toolCalls) {
                    if (!toolCall?.function) continue
                    content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: parseToolInput(toolCall.function.arguments)
                    })
                }
            }

            return {
                role: 'assistant',
                content
            }
        }
        case 'user': {
            if (!Array.isArray(source.content) || source.content.length === 0) {
                return { role: 'user', content: [{ type: 'text', text: '' }] }
            }
            const content = source.content.map(t => {
                switch (t.type) {
                    case 'text':
                        return {
                            type: 'text',
                            text: t.text || ''
                        }
                    case 'image': {
                        if (!t.image) return { type: 'text', text: '[Image unavailable]' }
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
                                text: '[Image URL not supported by Claude]'
                            }
                        } else {
                            source_data = t.image
                        }

                        return {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type,
                                data: source_data
                            }
                        }
                    }
                    default:
                        return {
                            type: 'text',
                            text: ''
                        }
                }
            })

            return {
                role: 'user',
                content
            }
        }
        case 'tool': {
            const srcContent = Array.isArray(source.content) ? source.content : []
            const content = srcContent.map(tcr => {
                const richContent = Array.isArray(tcr.mcpContent)
                    ? tcr.mcpContent.map(toClaudeToolResultBlock)
                    : tcr.content
                if (Array.isArray(richContent) && tcr.structuredContent !== undefined) {
                    richContent.push({
                        type: 'text',
                        text: `structuredContent: ${JSON.stringify(tcr.structuredContent)}`
                    })
                }
                return {
                    type: 'tool_result',
                    tool_use_id: tcr.tool_call_id,
                    content: richContent,
                    ...(tcr.isError === true ? { is_error: true } : {})
                }
            })

            return {
                role: 'user',
                content
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
registerIntoChaiteConverter('claude', response => {
    const content = []
    const toolCalls = []

    if (!Array.isArray(response?.content)) {
        return { role: 'assistant', content: [{ type: 'text', text: '' }] }
    }

    for (const block of response.content) {
        if (block.type === 'text') {
            content.push({
                type: 'text',
                text: block.text
            })
        }
        if (block.type === 'tool_use') {
            toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: block.input
                }
            })
        }
    }

    return {
        role: 'assistant',
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    }
})

/**
 * Convert Chaite Tool to Claude format
 */
registerFromChaiteToolConverter('claude', tool => {
    return toClaudeTool(tool)
})

export {}
