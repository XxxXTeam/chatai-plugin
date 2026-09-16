import {
    registerFromChaiteConverter,
    registerFromChaiteToolConverter,
    registerIntoChaiteConverter
} from '../../utils/converter.js'
import { toGeminiTool, generateDeterministicToolCallId } from '../tooling.js'
import { mcpContentBlockToText } from '../../utils/toolResult.js'

/**
 * 从 tool 消息的外层字段推导工具名。
 * tcr.name 由 executeToolCalls 的 toolName 计算写入，正常流程必有值；
 * 历史恢复或上游数据缺失时按外层层级兜底，绝不能把 functionResponse.name
 * 留空——Gemini 端点会直接拒绝
 * （"function_response.name: Name cannot be empty"）。
 *
 * @param {Object} tcr - tool 消息中的单条工具结果
 * @param {Object} [sourceMsg] - tool 消息本体（含外层 name/id 字段）
 * @returns {string} 永远非空的工具名
 */
function resolveToolResultName(tcr, sourceMsg) {
    const candidates = [tcr?.name, tcr?.functionName, sourceMsg?.name]
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return 'unknown_tool'
}

function parseFunctionArgs(args) {
    if (args === undefined || args === null) return {}
    if (typeof args !== 'string') return args && typeof args === 'object' ? args : { value: args }
    try {
        const parsed = JSON.parse(args)
        return parsed && typeof parsed === 'object' ? parsed : { value: parsed }
    } catch {
        return { input: args }
    }
}

/**
 * Convert Chaite IMessage to Gemini format
 */
registerFromChaiteConverter('gemini', source => {
    switch (source.role) {
        case 'assistant': {
            const parts = []

            // Add text content
            const textContent = source.content.filter(t => t.type === 'text').map(t => ({ text: t.text }))

            parts.push(...textContent)

            // Add function calls if present
            if (source.toolCalls && source.toolCalls.length > 0) {
                for (const toolCall of source.toolCalls) {
                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args: parseFunctionArgs(toolCall.function.arguments)
                        }
                    })
                }
            }

            return {
                role: 'model',
                parts
            }
        }
        case 'user': {
            const parts = source.content
                .map(t => {
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
                                        data: base64Data
                                    }
                                }
                            } else if (t.image) {
                                // Base64 without data URL prefix
                                return {
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: t.image
                                    }
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
                                        data: base64Data
                                    }
                                }
                            } else if (t.video) {
                                return {
                                    inlineData: {
                                        mimeType: t.mimeType || 'video/mp4',
                                        data: t.video
                                    }
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
                                        data: base64Data
                                    }
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
                                        data: base64Data
                                    }
                                }
                            } else if (t.data) {
                                return {
                                    inlineData: {
                                        mimeType: `audio/${t.format || 'mp3'}`,
                                        data: t.data
                                    }
                                }
                            }
                            return { text: '[语音]' }
                        case 'file':
                            // 文件类型转为文本描述
                            return { text: `[文件: ${t.name || t.file || ''}]` }
                        default:
                            return { text: '' }
                    }
                })
                .filter(p => p.text !== '' || p.inlineData)

            return {
                role: 'user',
                parts
            }
        }
        case 'tool': {
            return source.content.map(tcr => {
                let responseContent = tcr.content || ''

                if (typeof responseContent === 'string' && responseContent.startsWith('{')) {
                    try {
                        responseContent = JSON.parse(responseContent)
                    } catch {
                        // 保留兼容文本。
                    }
                }

                const response =
                    responseContent && typeof responseContent === 'object'
                        ? { ...responseContent }
                        : { content: responseContent }
                if (Array.isArray(tcr.mcpContent)) {
                    response.mcpContent = tcr.mcpContent.map(block => ({
                        type: block?.type || 'unknown',
                        text: mcpContentBlockToText(block)
                    }))
                }
                if (tcr.structuredContent !== undefined) {
                    response.structuredContent = tcr.structuredContent
                }
                if (tcr.isError === true) response.isError = true

                // functionResponse.name 必须非空，否则 Gemini 端点直接 400；
                // name 字段本身在历史持久化/恢复链路中可能丢失，因此绝不能依赖
                // 过滤器丢弃无 name 结果（原实现会静默丢 part，导致模型看不到结果）
                const toolResultName = resolveToolResultName(tcr, source)

                return {
                    role: 'function',
                    parts: [
                        {
                            functionResponse: {
                                name: toolResultName,
                                response
                            }
                        }
                    ]
                }
            })
        }
        default: {
            throw new Error(`Unknown role: ${source.role}`)
        }
    }
})

/**
 * Convert Gemini format to Chaite IMessage
 */
registerIntoChaiteConverter('gemini', response => {
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
                text: part.text
            })
        }
        if (part.functionCall) {
            // Gemini 原生 functionCall 无 id，使用确定性 ID：
            // 同一调用在重试/重放/历史恢复后 ID 不变，不会漂移；
            // 也满足 OpenAI 兼容端点 id 必须为字符串的要求（不会产生数字型 id）
            toolCalls.push({
                id: generateDeterministicToolCallId(part.functionCall.name, part.functionCall.args),
                type: 'function',
                function: {
                    name: part.functionCall.name,
                    arguments: part.functionCall.args
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
 * Convert Chaite Tool to Gemini format
 */
registerFromChaiteToolConverter('gemini', tool => {
    return toGeminiTool(tool)
})

export {}
