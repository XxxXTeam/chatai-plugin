import crypto from 'node:crypto'
import config from '../../../config/config.js'
import {
    BaseClientOptions,
    ChaiteContext,
    DefaultLogger,
    MultipleKeyStrategyChoice,
    SendMessageOption
} from '../types/index.js'
import DefaultHistoryManager from '../utils/history.js'
import { asyncLocalStorage, getKey } from '../utils/index.js'
import { logService } from '../../services/stats/LogService.js'
import { toolApprovalService } from '../../services/tools/ToolApprovalService.js'
import { attachToolMetadata, getToolDefinitionName, getToolIdentity, normalizeAnyToolCallId } from './tooling.js'
import { normalizeToolExecutionResult, sanitizeToolResultForLog } from '../utils/toolResult.js'

/**
 * 生成工具调用ID
 */
function generateToolId(prefix = 'tool') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 归一化工具调用 ID：任何来源的工具调用 ID 写入结果/历史前统一为字符串。
 * 与发送出口（openai/gemini 转换器）共用 tooling.js 的同一实现，保证
 * assistant 侧 id 与 tool 侧 tool_call_id 的字符串化口径一致。
 * @param {*} toolCallId - 上游工具调用 ID（string/number/空值）
 * @returns {string} 合法 ID；空值兜底为随机 UUID 字符串
 */
const normalizeToolCallIdForResult = normalizeAnyToolCallId

/**
 * @param {any} args - 参数
 * @param {boolean} [strict=false] - 严格模式，无法解析时返回null而非空对象
 * @returns {string|null} JSON字符串或null（严格模式下解析失败）
 */
function normalizeToolArguments(args, strict = false) {
    if (args === undefined || args === null) {
        return strict ? null : '{}'
    }

    if (typeof args === 'string') {
        let str = args.trim()

        // 空字符串或仅包含 { 的无效字符串
        if (!str || str === '{' || str === '"' || str === '"{' || str === '{"{') {
            return strict ? null : '{}'
        }

        // 尝试直接解析
        try {
            const parsed = JSON.parse(str)
            if (typeof parsed === 'object' && parsed !== null) {
                return str
            }
        } catch {}
        let fixed = str
        if ((fixed.startsWith('"') && fixed.endsWith('"')) || (fixed.startsWith("'") && fixed.endsWith("'"))) {
            fixed = fixed.slice(1, -1)
        }
        fixed = fixed.replace(/\\"/g, '"').replace(/\\'/g, "'")
        if (fixed.startsWith('"{') && fixed.endsWith('}"')) {
            fixed = fixed.slice(1, -1)
        }
        fixed = fixed.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, '{"$1":')
        fixed = fixed.replace(/,\s*([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, ',"$1":')
        fixed = fixed.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)"}/g, ':"$1"}')
        fixed = fixed.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)",/g, ':"$1",')
        for (let i = 0; i < 5; i++) {
            try {
                const parsed = JSON.parse(fixed)
                if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
                    return fixed
                }
                break
            } catch {
                if (fixed.endsWith('}}')) {
                    fixed = fixed.slice(0, -1)
                } else if (fixed.endsWith(']]')) {
                    fixed = fixed.slice(0, -1)
                } else {
                    break
                }
            }
        }
        try {
            const parsed = JSON.parse(fixed)
            if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
                return fixed
            }
        } catch {}
        if (!fixed.startsWith('{') && !fixed.startsWith('[')) {
            if (fixed.includes('=')) {
                const obj = {}
                fixed.split(/[,&]/).forEach(pair => {
                    const [key, ...valueParts] = pair.split('=')
                    if (key && valueParts.length > 0) {
                        obj[key.trim()] = valueParts.join('=').trim()
                    }
                })
                if (Object.keys(obj).length > 0) {
                    return JSON.stringify(obj)
                }
            }
            if (!strict && fixed.length > 2) {
                return JSON.stringify({ text: fixed })
            }
        }
        return strict ? null : '{}'
    }
    if (typeof args === 'object' && Object.keys(args).length > 0) {
        return JSON.stringify(args)
    }

    return strict ? null : '{}'
}

/**
 * @param {string} text - 响应文本
 * @returns {{ cleanText: string, toolCalls: Array }} 清理后的文本和解析出的工具调用
 */
export function parseXmlToolCalls(text) {
    if (!text || typeof text !== 'string') {
        return { cleanText: text || '', toolCalls: [] }
    }

    const toolCalls = []
    let cleanText = text
    cleanText = cleanText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<glm_block[\s\S]*?<\/glm_block>/gi, '')
        .replace(/<glm_block[^>]*>[\s\S]*$/gi, '')
        .replace(/[^\u4e00-\u9fa5\n]*?"type"\s*:\s*"mcp"\s*\}\s*<\/glm_block>/gi, '')
        .replace(/[^\u4e00-\u9fa5\n]*?\}\s*<\/glm_block>/gi, '')
        .replace(/<\/?glm_block[^>]*>/gi, '')
        .replace(/<\/?think>/gi, '')
        .trim()

    // 格式A:  JSON
    const toolsRegex = /<tools>([\s\S]*?)<\/tools>/gi
    let match

    while ((match = toolsRegex.exec(text)) !== null) {
        const toolContent = match[1].trim()
        try {
            const toolData = JSON.parse(toolContent)
            // 支持单个工具或工具数组
            const tools = Array.isArray(toolData) ? toolData : [toolData]
            for (const tool of tools) {
                const funcName = tool.function?.name || tool.name
                const funcArgs = tool.function?.arguments || tool.arguments
                if (funcName) {
                    toolCalls.push({
                        id: tool.id || generateToolId('xml'),
                        type: 'function',
                        function: {
                            name: funcName,
                            arguments: normalizeToolArguments(funcArgs)
                        }
                    })
                    logger.debug(`[Tool Parser] 解析到<tools>格式: ${funcName}`)
                }
            }
        } catch (parseErr) {
            logger.warn(`[Tool Parser] <tools>解析失败:`, parseErr.message)
        }
    }
    cleanText = cleanText.replace(toolsRegex, '').trim()

    // 格式B: <tool_call>name<arg_key>key</arg_key><arg_value>value</arg_value></tool_call>
    const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi

    while ((match = toolCallRegex.exec(text)) !== null) {
        const toolContent = match[1].trim()
        try {
            // 首先尝试作JSON解析
            if (toolContent.startsWith('{') || toolContent.startsWith('[')) {
                try {
                    const toolData = JSON.parse(toolContent)
                    const funcName = toolData.function?.name || toolData.name
                    const funcArgs = toolData.function?.arguments || toolData.arguments
                    if (funcName) {
                        toolCalls.push({
                            id: toolData.id || generateToolId('xml'),
                            type: 'function',
                            function: {
                                name: funcName,
                                arguments: normalizeToolArguments(funcArgs)
                            }
                        })
                        logger.debug(`[Tool Parser] 解析到<tool_call>JSON格式: ${funcName}`)
                        continue
                    }
                } catch {}
            }

            // 回退到原始格式解析
            const nameMatch = toolContent.match(/^([^<\s{\[]+)/)
            if (!nameMatch) continue
            const toolName = nameMatch[1].trim()

            const args = {}
            const argKeyRegex = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi
            let argMatch
            while ((argMatch = argKeyRegex.exec(toolContent)) !== null) {
                const key = argMatch[1].trim()
                let value = argMatch[2].trim()

                if (/^-?\d+$/.test(value)) value = parseInt(value, 10)
                else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value)
                else if (value === 'true') value = true
                else if (value === 'false') value = false
                else if (value === 'null') value = null

                args[key] = value
            }

            toolCalls.push({
                id: generateToolId('xml'),
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) }
            })
            logger.debug(`[Tool Parser] 解析到<tool_call>格式: ${toolName}`)
        } catch (parseErr) {
            logger.warn(`[Tool Parser] <tool_call>解析失败:`, parseErr.message)
        }
    }
    cleanText = cleanText.replace(toolCallRegex, '').trim()
    const funcCallRegex = /<function_call>([\s\S]*?)<\/function_call>/gi
    while ((match = funcCallRegex.exec(text)) !== null) {
        const content = match[1].trim()
        try {
            const toolData = JSON.parse(content)
            const funcName = toolData.function?.name || toolData.name
            const funcArgs = toolData.function?.arguments || toolData.arguments
            if (funcName) {
                toolCalls.push({
                    id: toolData.id || generateToolId('func'),
                    type: 'function',
                    function: {
                        name: funcName,
                        arguments: normalizeToolArguments(funcArgs)
                    }
                })
                logger.debug(`[Tool Parser] 解析到<function_call>格式: ${funcName}`)
            }
        } catch (parseErr) {
            logger.warn(`[Tool Parser] <function_call>解析失败:`, parseErr.message)
        }
    }
    cleanText = cleanText.replace(funcCallRegex, '').trim()
    const invokeRegex = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi
    while ((match = invokeRegex.exec(text)) !== null) {
        const funcName = match[1].trim()
        const argsContent = match[2].trim()
        try {
            let args = {}
            if (argsContent.startsWith('{')) {
                args = JSON.parse(argsContent)
            } else {
                // 解析 <param name="key">value</param> 格式
                const paramRegex = /<param\s+name=["']([^"']+)["']>([\s\S]*?)<\/param>/gi
                let paramMatch
                while ((paramMatch = paramRegex.exec(argsContent)) !== null) {
                    const key = paramMatch[1].trim()
                    let value = paramMatch[2].trim()
                    if (/^-?\d+$/.test(value)) value = parseInt(value, 10)
                    else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value)
                    else if (value === 'true') value = true
                    else if (value === 'false') value = false
                    args[key] = value
                }
            }
            toolCalls.push({
                id: generateToolId('invoke'),
                type: 'function',
                function: { name: funcName, arguments: JSON.stringify(args) }
            })
            logger.debug(`[Tool Parser] 解析到<invoke>格式: ${funcName}`)
        } catch (parseErr) {
            logger.warn(`[Tool Parser] <invoke>解析失败:`, parseErr.message)
        }
    }
    cleanText = cleanText.replace(invokeRegex, '').trim()
    const fixMalformedJson = jsonStr => {
        let fixed = jsonStr
        fixed = fixed.replace(/"arguments"\s*:\s*"(\{(?:[^"\\]|\\.)*\})(\}+)"/g, (match, validJson) => {
            let braceCount = 0
            for (const char of validJson) {
                if (char === '{') braceCount++
                else if (char === '}') braceCount--
            }
            if (braceCount === 0) {
                return `"arguments":"${validJson}"`
            }
            return match
        })
        const argPattern = /"arguments"\s*:\s*"(\{[^"]*"[^}]*\})"/g
        let match
        while ((match = argPattern.exec(jsonStr)) !== null) {
            const badArgs = match[1]
            const fixedArgs = badArgs.replace(/"/g, '\\"')
            fixed = fixed.replace(match[0], `"arguments":"${fixedArgs}"`)
        }
        try {
            const parsed = JSON.parse(fixed)
            if (parsed.tool_calls) {
                for (const tc of parsed.tool_calls) {
                    if (tc.function?.arguments && typeof tc.function.arguments === 'string') {
                        try {
                            JSON.parse(tc.function.arguments)
                        } catch {
                            let args = tc.function.arguments
                            while (args.endsWith('}}') || args.endsWith('}}')) {
                                const testArgs = args.slice(0, -1)
                                try {
                                    JSON.parse(testArgs)
                                    args = testArgs
                                    break
                                } catch {
                                    args = testArgs
                                }
                            }
                            tc.function.arguments = args.replace(/^"/, '').replace(/"$/, '').replace(/\\"/g, '"')
                        }
                    }
                }
                return JSON.stringify(parsed)
            }
        } catch {}
        fixed = fixed.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
        fixed = fixed.replace(/,\s*([\]}])/g, '$1')
        let lastFixed = fixed
        for (let i = 0; i < 3; i++) {
            try {
                JSON.parse(lastFixed)
                break
            } catch {
                if (lastFixed.endsWith(']}')) {
                    const test1 = lastFixed.slice(0, -1)
                    try {
                        JSON.parse(test1)
                        lastFixed = test1
                        continue
                    } catch {}
                }
                if (lastFixed.endsWith('}}')) {
                    const test2 = lastFixed.slice(0, -1)
                    try {
                        JSON.parse(test2)
                        lastFixed = test2
                        continue
                    } catch {}
                }
                break
            }
        }
        fixed = lastFixed
        return fixed
    }

    const jsonCodeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi
    const codeBlockMatches = [...text.matchAll(jsonCodeBlockRegex)]

    for (const blockMatch of codeBlockMatches) {
        const blockContent = blockMatch[1].trim()
        if (blockContent.startsWith('[') || blockContent.startsWith('{')) {
            let parsed = null
            try {
                parsed = JSON.parse(blockContent)
            } catch {
                try {
                    const fixedContent = fixMalformedJson(blockContent)
                    parsed = JSON.parse(fixedContent)
                    logger.debug('[Tool Parser] 修复格式错误的JSON成功')
                } catch {
                    continue
                }
            }
            if (!parsed) continue
            try {
                const beforeCount = toolCalls.length
                if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                    for (const tc of parsed.tool_calls) {
                        const funcName = tc.function?.name || tc.name
                        const funcArgs = tc.function?.arguments || tc.arguments
                        if (funcName) {
                            toolCalls.push({
                                id: tc.id || generateToolId('block'),
                                type: 'function',
                                function: {
                                    name: funcName,
                                    arguments: normalizeToolArguments(funcArgs)
                                }
                            })
                            logger.debug(`[Tool Parser] 解析到tool_calls格式: ${funcName}`)
                        }
                    }
                } else {
                    if (!Array.isArray(parsed)) parsed = [parsed]
                    for (const item of parsed) {
                        const funcName = item.function?.name || item.name || item.tool_name
                        const funcArgs = item.function?.arguments || item.arguments || item.tool_params || item.params
                        if (funcName && (funcArgs !== undefined || Object.keys(item).length > 1)) {
                            toolCalls.push({
                                id: item.id || generateToolId('block'),
                                type: 'function',
                                function: {
                                    name: funcName,
                                    arguments: normalizeToolArguments(funcArgs)
                                }
                            })
                            logger.debug(`[Tool Parser] 解析到JSON代码块格式: ${funcName}`)
                        }
                    }
                }
                if (toolCalls.length > beforeCount) {
                    cleanText = cleanText.replace(blockMatch[0], '').trim()
                }
            } catch {}
        }
    }
    if (toolCalls.length === 0) {
        const toolCallsStartRegex = /\{\s*"tool_calls"\s*:/g
        let startMatch
        const processedRanges = []

        while ((startMatch = toolCallsStartRegex.exec(cleanText)) !== null) {
            const startIdx = startMatch.index
            let braceCount = 0
            let endIdx = -1
            let inString = false
            let escapeNext = false

            for (let i = startIdx; i < cleanText.length; i++) {
                const char = cleanText[i]

                if (escapeNext) {
                    escapeNext = false
                    continue
                }
                if (char === '\\' && inString) {
                    escapeNext = true
                    continue
                }
                if (char === '"' && !escapeNext) {
                    inString = !inString
                    continue
                }
                if (!inString) {
                    if (char === '{') braceCount++
                    else if (char === '}') {
                        braceCount--
                        if (braceCount === 0) {
                            endIdx = i + 1
                            break
                        }
                    }
                }
            }
            if (endIdx > startIdx) {
                const objStr = cleanText.substring(startIdx, endIdx)
                let parsed = null
                try {
                    parsed = JSON.parse(objStr)
                } catch {
                    try {
                        const fixedStr = fixMalformedJson(objStr)
                        parsed = JSON.parse(fixedStr)
                        logger.debug('[Tool Parser] 修复裸JSON格式错误成功')
                    } catch {}
                }
                if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
                    for (const tc of parsed.tool_calls) {
                        const funcName = tc.function?.name || tc.name
                        const funcArgs = tc.function?.arguments || tc.arguments
                        if (funcName) {
                            toolCalls.push({
                                id: tc.id || generateToolId('json'),
                                type: 'function',
                                function: {
                                    name: funcName,
                                    arguments: normalizeToolArguments(funcArgs)
                                }
                            })
                            logger.debug(`[Tool Parser] 解析到裸JSON tool_calls格式: ${funcName}`)
                        }
                    }
                    // 成功解析到tool_calls结构，清理JSON
                    processedRanges.push({ start: startIdx, end: endIdx })
                }
            }
        }
        for (let i = processedRanges.length - 1; i >= 0; i--) {
            const range = processedRanges[i]
            cleanText = cleanText.substring(0, range.start) + cleanText.substring(range.end)
        }
        cleanText = cleanText.trim()
        const jsonArrayRegex = /\[\s*\{[\s\S]*?"name"\s*:\s*"[^"]+[\s\S]*?\}\s*\]/g
        const arrayMatches = cleanText.match(jsonArrayRegex)

        if (arrayMatches) {
            for (const arrayStr of arrayMatches) {
                try {
                    let parsed
                    try {
                        parsed = JSON.parse(arrayStr)
                    } catch {
                        const fixed = fixMalformedJson(arrayStr)
                        parsed = JSON.parse(fixed)
                    }
                    if (Array.isArray(parsed)) {
                        let foundTools = false
                        for (const item of parsed) {
                            const funcName = item.function?.name || item.name || item.tool_name
                            const funcArgs =
                                item.function?.arguments || item.arguments || item.tool_params || item.params
                            if (funcName) {
                                toolCalls.push({
                                    id: item.id || generateToolId('array'),
                                    type: 'function',
                                    function: {
                                        name: funcName,
                                        arguments: normalizeToolArguments(funcArgs)
                                    }
                                })
                                foundTools = true
                                logger.debug(`[Tool Parser] 解析到纯JSON数组格式: ${funcName}`)
                            }
                        }
                        if (foundTools) {
                            cleanText = cleanText.replace(arrayStr, '').trim()
                        }
                    }
                } catch {}
            }
        }
        const singleToolRegex =
            /\{\s*"(?:name|function)"\s*:\s*"([^"]+)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*?\}|\"[^"]*\")\s*\}/g
        let singleMatch
        while ((singleMatch = singleToolRegex.exec(cleanText)) !== null) {
            try {
                const objStr = singleMatch[0]
                let parsed
                try {
                    parsed = JSON.parse(objStr)
                } catch {
                    const fixed = fixMalformedJson(objStr)
                    parsed = JSON.parse(fixed)
                }
                const funcName = parsed.function?.name || parsed.name
                const funcArgs = parsed.function?.arguments || parsed.arguments
                if (funcName && !toolCalls.some(tc => tc.function.name === funcName)) {
                    toolCalls.push({
                        id: parsed.id || generateToolId('single'),
                        type: 'function',
                        function: {
                            name: funcName,
                            arguments: normalizeToolArguments(funcArgs)
                        }
                    })
                    cleanText = cleanText.replace(objStr, '').trim()
                    logger.debug(`[Tool Parser] 解析到单独工具对象格式: ${funcName}`)
                }
            } catch {
                // 解析失败，跳过
            }
        }
    }
    if (toolCalls.length === 0) {
        const escapedArgsPattern =
            /"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,\s*"arguments"\s*:\s*"(\{(?:[^"\\]|\\.|"(?:[^"\\]|\\.)*")*\})"/g
        let escapedMatch
        while ((escapedMatch = escapedArgsPattern.exec(cleanText)) !== null) {
            const funcName = escapedMatch[1]
            let funcArgs = escapedMatch[2]
            if (funcName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(funcName) && funcName.length >= 2) {
                try {
                    funcArgs = JSON.parse(`"${funcArgs}"`)
                } catch {}
                const normalizedArgs = normalizeToolArguments(funcArgs, false)
                if (!toolCalls.some(tc => tc.function.name === funcName)) {
                    toolCalls.push({
                        id: generateToolId('escaped'),
                        type: 'function',
                        function: {
                            name: funcName,
                            arguments: normalizedArgs
                        }
                    })
                    cleanText = cleanText.replace(escapedMatch[0], '').trim()
                    logger.debug(`[Tool Parser] 解析到转义JSON参数工具: ${funcName}`)
                }
            }
        }
    }
    if (toolCalls.length === 0) {
        const nameMatch = cleanText.match(/"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/i)
        if (nameMatch) {
            const funcName = nameMatch[1]
            // 查找 arguments 字段 - 支持对象或字符串格式
            const argsStartMatch = cleanText.match(/"arguments"\s*:\s*/)
            if (argsStartMatch) {
                const argsStartIdx = cleanText.indexOf(argsStartMatch[0]) + argsStartMatch[0].length
                let funcArgs = '{}'

                if (cleanText[argsStartIdx] === '"') {
                    // arguments 是字符串格式: "arguments": "{...}"
                    // 需要找到配对的引号（考虑转义）
                    let endIdx = argsStartIdx + 1
                    while (endIdx < cleanText.length) {
                        if (cleanText[endIdx] === '"' && cleanText[endIdx - 1] !== '\\') {
                            break
                        }
                        endIdx++
                    }
                    const argsStr = cleanText.substring(argsStartIdx + 1, endIdx)
                    try {
                        funcArgs = JSON.parse(`"${argsStr}"`)
                    } catch {
                        funcArgs = argsStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
                    }
                } else if (cleanText[argsStartIdx] === '{') {
                    // arguments 是对象格式: "arguments": {...}
                    let braceCount = 0
                    let endIdx = argsStartIdx
                    for (let i = argsStartIdx; i < cleanText.length; i++) {
                        if (cleanText[i] === '{') braceCount++
                        else if (cleanText[i] === '}') braceCount--
                        if (braceCount === 0) {
                            endIdx = i + 1
                            break
                        }
                    }
                    funcArgs = cleanText.substring(argsStartIdx, endIdx)
                }

                const normalizedArgs = normalizeToolArguments(funcArgs, false)
                if (normalizedArgs && normalizedArgs !== '{}') {
                    if (!toolCalls.some(tc => tc.function.name === funcName)) {
                        toolCalls.push({
                            id: generateToolId('extract'),
                            type: 'function',
                            function: {
                                name: funcName,
                                arguments: normalizedArgs
                            }
                        })
                        logger.debug(`[Tool Parser] 提取到工具调用: ${funcName}, 参数长度: ${normalizedArgs.length}`)
                    }
                }
            }
        }
    }
    if (toolCalls.length === 0) {
        const fuzzyNamePatterns = [
            /"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*?\}|"[^"]*")/g,
            /"function"\s*:\s*\{\s*"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*?\}|"[^"]*")/g,
            /\bname\s*[:=]\s*["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?[\s\S]*?\barguments\s*[:=]\s*(\{[\s\S]*?\}|["'][^"']*["'])/gi
        ]
        for (const pattern of fuzzyNamePatterns) {
            let fuzzyMatch
            while ((fuzzyMatch = pattern.exec(cleanText)) !== null) {
                const funcName = fuzzyMatch[1]
                let funcArgs = fuzzyMatch[2]
                if (funcName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(funcName) && funcName.length >= 2) {
                    const normalizedArgs = normalizeToolArguments(funcArgs, false)
                    if (!toolCalls.some(tc => tc.function.name === funcName)) {
                        toolCalls.push({
                            id: generateToolId('fuzzy'),
                            type: 'function',
                            function: {
                                name: funcName,
                                arguments: normalizedArgs
                            }
                        })
                        cleanText = cleanText.replace(fuzzyMatch[0], '').trim()
                        logger.debug(`[Tool Parser] 模糊匹配解析到工具: ${funcName}`)
                    }
                }
            }
            if (toolCalls.length > 0) {
                cleanText = cleanText
                    .replace(/\{\s*"tool_calls"\s*:\s*\[\s*\{[^}]*\}?\s*\]?\s*\}?/g, '')
                    .replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*$/g, '')
                    .trim()
                break
            }
        }
    }
    if (toolCalls.length === 0) {
        const funcCallPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*(\{[\s\S]*?\})\s*\)/g
        let funcMatch
        while ((funcMatch = funcCallPattern.exec(cleanText)) !== null) {
            const funcName = funcMatch[1]
            const funcArgs = funcMatch[2]
            const excludeNames = [
                'if',
                'for',
                'while',
                'switch',
                'function',
                'return',
                'console',
                'log',
                'JSON',
                'Object',
                'Array',
                'String',
                'Number',
                'Boolean',
                'Date',
                'Math',
                'Error'
            ]
            if (!excludeNames.includes(funcName) && funcName.length >= 2) {
                try {
                    JSON.parse(funcArgs)
                    if (!toolCalls.some(tc => tc.function.name === funcName)) {
                        toolCalls.push({
                            id: generateToolId('funcall'),
                            type: 'function',
                            function: {
                                name: funcName,
                                arguments: normalizeToolArguments(funcArgs)
                            }
                        })
                        cleanText = cleanText.replace(funcMatch[0], '').trim()
                        logger.debug(`[Tool Parser] 函数调用格式解析到工具: ${funcName}`)
                    }
                } catch {}
            }
        }
    }
    if (toolCalls.length === 0) {
        const toolNameHints = cleanText.match(/"(?:name|function)"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g)
        if (toolNameHints) {
            for (const hint of toolNameHints) {
                const nameMatch = hint.match(/"(?:name|function)"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/)
                if (nameMatch) {
                    const funcName = nameMatch[1]
                    const hintIdx = cleanText.indexOf(hint)
                    const searchArea = cleanText.substring(hintIdx, Math.min(hintIdx + 500, cleanText.length))
                    const argsMatch = searchArea.match(/"arguments"\s*:\s*(\{[\s\S]*?\}|"[^"]*")/)
                    if (!argsMatch) {
                        logger.debug(`[Tool Parser] 跳过无参数的工具调用: ${funcName}`)
                        continue
                    }
                    // 尝试规范化参数，无效参数也保留工具调用（让执行时报错）
                    const normalizedArgs = normalizeToolArguments(argsMatch[1], false)
                    if (!toolCalls.some(tc => tc.function.name === funcName)) {
                        toolCalls.push({
                            id: generateToolId('recover'),
                            type: 'function',
                            function: {
                                name: funcName,
                                arguments: normalizedArgs
                            }
                        })
                        logger.debug(`[Tool Parser] 从损坏JSON恢复工具: ${funcName}`)
                    }
                }
            }
        }
    }
    cleanText = cleanText
        .replace(/```(?:json)?\s*```/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    if (toolCalls.length > 0) {
        cleanText = cleanText
            .replace(/```(?:json)?\s*[\s\S]*?"(?:user_id|nickname|message|name|arguments)"[\s\S]*?```/gi, '')
            .replace(/```(?:json)?\s*,?\s*\[?\s*\{[\s\S]*?\}\s*\]?\s*```/gi, '')
            .trim()
    }
    const toolArgFragmentPatterns = [
        /^\s*,?\s*\[?\s*\{[^{}]*"user_id"[^{}]*"nickname"[^{}]*"message"[^{}]*\}[\s\S]*$/,
        /^[\s\[\]\{\}"',:\\]+$/,
        /^[\s,\[\]\{\}"\\:a-zA-Z0-9_-]+$/,
        /^```(?:json)?\s*[\s\S]*```$/i
    ]

    for (const pattern of toolArgFragmentPatterns) {
        if (pattern.test(cleanText)) {
            const stripped = cleanText.replace(/"[^"]*"/g, '""').replace(/\\"/g, '')
            if (/^[\s\[\]\{\},:"'\\`a-zA-Z0-9_-]*$/.test(stripped) && cleanText.length < 1000) {
                logger.debug(`[Tool Parser] 清理残留的工具参数片段: ${cleanText.substring(0, 100)}...`)
                cleanText = ''
                break
            }
        }
    }

    // 工具调用数量限制和智能去重
    const MAX_TOOL_CALLS = 15
    if (toolCalls.length > 0) {
        // 智能去重：只去除连续重复的调用，允许间隔的重复调用（如多次@同一个人）
        // 同时记录每个工具调用的次数，超过阈值才去重
        const deduped = []
        const callCounts = new Map() // 工具调用计数
        const MAX_SAME_CALL = 3 // 同一调用最多允许次数

        for (const tc of toolCalls) {
            const sig = `${tc.function.name}:${tc.function.arguments}`
            const count = callCounts.get(sig) || 0

            // 检查是否与上一个调用完全相同（连续重复）
            const lastCall = deduped[deduped.length - 1]
            const isConsecutiveDupe =
                lastCall &&
                lastCall.function.name === tc.function.name &&
                lastCall.function.arguments === tc.function.arguments

            // 允许非连续重复，或者次数未超限
            if (!isConsecutiveDupe && count < MAX_SAME_CALL) {
                callCounts.set(sig, count + 1)
                deduped.push(tc)
            } else if (isConsecutiveDupe) {
                logger.debug(`[Tool Parser] 跳过连续重复调用: ${tc.function.name}`)
            } else {
                logger.debug(`[Tool Parser] 同一调用超过 ${MAX_SAME_CALL} 次，跳过: ${tc.function.name}`)
            }
        }

        if (deduped.length > MAX_TOOL_CALLS) {
            logger.warn(`[Tool Parser] 工具调用数量 ${deduped.length} 超过限制 ${MAX_TOOL_CALLS}，截断`)
            deduped.length = MAX_TOOL_CALLS
        }

        if (deduped.length !== toolCalls.length) {
            logger.debug(`[Tool Parser] 智能去重: ${toolCalls.length} -> ${deduped.length}`)
        }
        cleanText = cleanText
            .replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/g, '')
            .replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*$/g, '') // 被截断的情况
            .replace(/^\s*\[\s*\{[\s\S]*?"function"[\s\S]*?\}\s*\]\s*$/g, '') // 纯工具调用数组
            .trim()

        return { cleanText, toolCalls: deduped }
    }

    return { cleanText, toolCalls }
}

/**
 * 将URL资源转换为base64
 * @param {string} url - 资源URL
 * @param {string} [defaultMimeType] - 默认MIME类型
 * @returns {Promise<{mimeType: string, data: string}>}
 */
/**
 * URL转Base64配置
 */
const URL_TO_BASE64_CONFIG = {
    maxRetries: 1,
    retryDelay: 500,
    timeout: 15000,
    userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

/**
 * 将URL资源转换为base64（增强版，带重试和错误处理）
 * @param {string} url - 资源URL
 * @param {string} [defaultMimeType] - 默认MIME类型
 * @param {Object} [options] - 选项
 * @returns {Promise<{mimeType: string, data: string}>}
 */
async function urlToBase64(url, defaultMimeType = 'application/octet-stream', options = {}) {
    const { maxRetries = URL_TO_BASE64_CONFIG.maxRetries, retryDelay = URL_TO_BASE64_CONFIG.retryDelay } = options

    try {
        // 处理本地文件路径
        if (url.startsWith('file://') || (url.startsWith('/') && !url.startsWith('//'))) {
            const fs = await import('node:fs')
            const path = await import('node:path')
            const filePath = url.replace('file://', '')

            if (!fs.existsSync(filePath)) {
                const err = new Error(`本地文件不存在: ${filePath}`)
                logService.mediaError('file', url, err)
                throw err
            }

            const buffer = fs.readFileSync(filePath)
            const ext = path.extname(filePath).toLowerCase().slice(1)
            const mimeType = getMimeType(ext) || defaultMimeType
            return { mimeType, data: buffer.toString('base64') }
        }

        // 处理已经是 base64 的情况
        if (url.startsWith('base64://')) {
            return { mimeType: defaultMimeType, data: url.replace('base64://', '') }
        }
        if (url.startsWith('data:')) {
            const [header, data] = url.split(',')
            const mimeType = header.match(/data:([^;]+)/)?.[1] || defaultMimeType
            return { mimeType, data }
        }
        let lastError = null
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const controller = new AbortController()
            // 定时器必须在 finally 中清理：DNS 失败/ECONNREFUSED 会跳过成功分支，
            // 使定时器残留到超时时长结束才被回收
            const timeoutId = setTimeout(() => controller.abort(), URL_TO_BASE64_CONFIG.timeout)
            try {
                // SSRF 预检：校验不通过即判为不可用，直接返回空数据（原先 .catch(()=>{}) 会吞掉错误使守卫失效）
                const { assertSafeUrl } = await import('../../mcp/tools/helpers.js')
                try {
                    await assertSafeUrl(url)
                } catch (ssrfError) {
                    logger.debug(`[urlToBase64] URL 安全校验未通过，跳过: ${ssrfError.message}`)
                    return { mimeType: defaultMimeType, data: '', error: ssrfError.message }
                }
                const isQQPic =
                    url.includes('gchat.qpic.cn') ||
                    url.includes('c2cpicdw.qpic.cn') ||
                    url.includes('p.qpic.cn') ||
                    url.includes('multimedia.nt.qq.com')
                const referer = isQQPic ? 'https://qzone.qq.com/' : new URL(url).origin + '/'

                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': URL_TO_BASE64_CONFIG.userAgent,
                        Accept: '*/*',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        Referer: referer
                    }
                })

                if (!response.ok) {
                    const err = new Error(`HTTP ${response.status}: ${response.statusText}`)
                    err.status = response.status
                    err.statusText = response.statusText
                    throw err
                }

                const contentType = response.headers.get('content-type') || defaultMimeType
                const buffer = Buffer.from(await response.arrayBuffer())

                return {
                    mimeType: contentType.split(';')[0],
                    data: buffer.toString('base64')
                }
            } catch (fetchErr) {
                lastError = fetchErr

                // 检测客户端错误（4xx）- 多种检测方式
                const is4xxError =
                    (fetchErr.status >= 400 && fetchErr.status < 500) || /HTTP\s*4\d{2}/i.test(fetchErr.message)
                const isQQMedia =
                    url.includes('multimedia.nt.qq.com.cn') ||
                    url.includes('gchat.qpic.cn') ||
                    url.includes('c2cpicdw.qpic.cn')

                if (is4xxError || isQQMedia) {
                    logger.debug(
                        `[urlToBase64] 媒体获取失败(${fetchErr.status || '4xx'})，跳过: ${url.substring(0, 60)}...`
                    )
                    break
                }
                if (attempt < maxRetries) {
                    logger.debug(`[urlToBase64] 第${attempt + 1}次获取失败，${retryDelay}ms后重试: ${fetchErr.message}`)
                    await new Promise(r => setTimeout(r, retryDelay))
                }
            } finally {
                clearTimeout(timeoutId)
            }
        }

        // 所有重试都失败
        if (lastError) {
            // 检测客户端错误或 QQ 媒体 URL
            const is4xxError =
                (lastError.status >= 400 && lastError.status < 500) || /HTTP\s*4\d{2}/i.test(lastError.message)
            const isQQMedia =
                url.includes('multimedia.nt.qq.com.cn') ||
                url.includes('gchat.qpic.cn') ||
                url.includes('c2cpicdw.qpic.cn')

            if (is4xxError || isQQMedia) {
                // 静默返回空数据，不记录错误日志
                return { mimeType: defaultMimeType, data: '', error: lastError.message }
            }
            // 只有非 4xx 且非 QQ 媒体的错误才记录
            logService.mediaError('url', url, lastError)
        }

        // 标记错误已记录，避免外层 catch 重复记录
        const err = new Error(
            `获取媒体文件失败 (${URL_TO_BASE64_CONFIG.maxRetries + 1}次尝试): ${lastError?.message || '未知错误'}`
        )
        err.logged = true
        throw err
    } catch (error) {
        // 只记录未标记的错误
        if (!error.logged) {
            // 再次检查是否为 QQ 媒体 URL 的 4xx 错误
            const is4xxError = /HTTP\s*4\d{2}/i.test(error.message)
            const isQQMedia =
                url.includes('multimedia.nt.qq.com.cn') ||
                url.includes('gchat.qpic.cn') ||
                url.includes('c2cpicdw.qpic.cn')

            if (!is4xxError && !isQQMedia) {
                logService.mediaError('media', url, error)
            }
            error.logged = true
        }
        throw error
    }
}

/** 历史消息图片并发处理上限：图片处理是网络 IO 密集任务，4 路并发可在不明显抬高瞬时连接数的前提下接近线性提速 */
const HISTORY_IMAGE_CONCURRENCY = 4

/** 历史消息图片获取超时（ms），默认沿用 urlToBase64 的请求超时 */
const HISTORY_IMAGE_FETCH_TIMEOUT = URL_TO_BASE64_CONFIG.timeout

/** 历史消息图片字节上限：超过该大小的历史图片不内联，避免单条消息撑爆请求体 */
const HISTORY_IMAGE_MAX_BYTES = 20 * 1024 * 1024

/** QQ 图床请求 Referer：图床对空 Referer 会拒绝返回图片 */
const QQ_PIC_REFERER = 'https://qzone.qq.com/'

/** 图片被移除后 content 变空的占位文本：空 content 数组发送给 API 会报错，用中性文本兜底 */
const HISTORY_IMAGE_REMOVED_PLACEHOLDER = '[历史图片已过期，已移除]'

/** QQ 图床域名白名单（含常见子域），仅这些域名需要在长上下文中刷新 rkey */
const QQ_PIC_HOSTS = [
    'gchat.qpic.cn',
    'c2cpicdw.qpic.cn',
    'p.qpic.cn',
    'multimedia.nt.qq.com',
    'multimedia.nt.qq.com.cn'
]

/** rkey 刷新服务模块缓存：undefined=未加载，null=不可用，对象=已加载 */
let rkeyRefreshModuleCache

/**
 * 判断 URL 是否属于 QQ 图床（按 hostname 精确比对，避免 includes 误判）
 * @param {string} url - 待判定 URL
 * @returns {boolean} 是否属于 QQ 图床域名
 */
function isQQPicUrl(url) {
    if (typeof url !== 'string' || !url) return false
    let hostname = ''
    try {
        hostname = new URL(url).hostname.toLowerCase()
    } catch {
        return false
    }
    if (!hostname) return false
    return QQ_PIC_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * 受控并发映射：结果数组与输入索引一一对应，任一 worker 抛错都不会中断整批
 * @param {Array} items - 待处理项
 * @param {number} limit - 最大并发数
 * @param {Function} worker - 单项处理函数 (item, index) => Promise<any>
 * @returns {Promise<Array>} 与输入等长、索引一致的结果数组
 */
async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length)
    let cursor = 0
    const size = Math.max(1, Math.min(limit, items.length))
    const runners = Array.from({ length: size }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            try {
                results[index] = await worker(items[index], index)
            } catch (err) {
                logger.debug('[MediaPreprocess] 并发处理异常:', err?.message)
                results[index] = { removed: true }
            }
        }
    })
    await Promise.all(runners)
    return results
}

/**
 * 收集历史消息中需要刷新/校验的 QQ 图床图片引用。
 * 只收集 user 角色消息里 http(s) 的 QQ 图床 URL；file://、base64://、data: 已内联不会过期，不做处理。
 * @param {Array} histories - 消息历史
 * @returns {Array<{item: Object, url: string, kind: string}>} 图片引用列表（item 为 content 数组中的对象引用）
 */
function collectHistoryImageRefs(histories) {
    const refs = []
    for (const msg of histories) {
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
        for (const item of msg.content) {
            if (item.type === 'image' && isQQPicUrl(item.image)) {
                refs.push({ item, url: item.image, kind: 'image' })
            } else if (item.type === 'image_url' && isQQPicUrl(item.image_url?.url)) {
                refs.push({ item, url: item.image_url.url, kind: 'image_url' })
            }
        }
    }
    return refs
}

/**
 * 加载 rkey 刷新服务模块。
 * 模块可能尚未提供或加载失败，任何异常都降级为「刷新不可用」，不得影响图片处理主流程。
 * @returns {Promise<Object|null>} 模块命名空间；不可用时返回 null
 */
async function loadRkeyRefreshModule() {
    if (rkeyRefreshModuleCache !== undefined) return rkeyRefreshModuleCache
    try {
        rkeyRefreshModuleCache = await import('../../services/media/RkeyRefreshService.js')
    } catch (err) {
        logger.debug('[MediaPreprocess] rkey 刷新服务不可用，跳过刷新:', err?.message)
        rkeyRefreshModuleCache = null
    }
    return rkeyRefreshModuleCache
}

/**
 * 判断当前 bot 是否具备 rkey 刷新能力
 * @param {Object|null} refresher - rkey 刷新服务
 * @param {Object|null} bot - Yunzai Bot 实例
 * @returns {boolean} 是否可尝试刷新
 */
function canRefreshWithBot(refresher, bot) {
    if (!bot || typeof refresher?.refreshImageUrl !== 'function') return false
    if (typeof refresher.hasRefreshCapability !== 'function') return true
    try {
        return refresher.hasRefreshCapability(bot) === true
    } catch (err) {
        logger.debug('[MediaPreprocess] rkey 能力检测失败:', err?.message)
        return false
    }
}

/**
 * 调用 rkey 刷新服务，永不抛异常
 * @param {Object} refresher - rkey 刷新服务
 * @param {string} url - 原始图片 URL
 * @param {Object} bot - Yunzai Bot 实例
 * @returns {Promise<Object|null>} 刷新结果，异常或非法返回时为 null
 */
async function safeRefreshImageUrl(refresher, url, bot) {
    try {
        const result = await refresher.refreshImageUrl(url, { bot })
        return result && typeof result === 'object' ? result : null
    } catch (err) {
        logger.debug('[MediaPreprocess] rkey 刷新异常:', err?.message)
        return null
    }
}

/**
 * 历史消息图片单次获取：一次 GET 同时完成「能否获取」判定与 base64 转换。
 * 按用户要求，图片可用性只能以真实获取结果为准，不使用 assertSafeUrl / validateImageUrl 之类的外部预检，
 * 避免预检结论与真实可得性不一致时误删可用图片。
 * 成功判据：HTTP ok（含 206）且响应体确为图片字节（content-type 为 image/* 或文件头魔数可识别）。
 * 失败判据：HTTP 400（含图床 download url has expired）/ 非图片内容 / 超出字节上限 / 超时 / 网络错误，
 * 一律返回 ok:false，由调用方移除该图片；本函数不抛异常。
 * @param {string} url - 图片 URL
 * @param {number} [timeout=HISTORY_IMAGE_FETCH_TIMEOUT] - 请求超时（ms）
 * @returns {Promise<{ok: boolean, mimeType: string, data: string, error?: string}>} 获取结果，data 为 base64
 */
async function fetchHistoryImageBytes(url, timeout = HISTORY_IMAGE_FETCH_TIMEOUT) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    try {
        let referer
        try {
            referer = isQQPicUrl(url) ? QQ_PIC_REFERER : new URL(url).origin + '/'
        } catch {
            referer = QQ_PIC_REFERER
        }
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': URL_TO_BASE64_CONFIG.userAgent,
                Accept: 'image/*,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                Referer: referer
            }
        })

        if (!response.ok && response.status !== 206) {
            logger.debug(`[MediaPreprocess] 图片获取失败 HTTP ${response.status}:`, url.substring(0, 50))
            return { ok: false, mimeType: 'image/jpeg', data: '', error: `HTTP ${response.status}` }
        }

        const declaredLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > HISTORY_IMAGE_MAX_BYTES) {
            logger.debug(
                `[MediaPreprocess] 图片过大(${(declaredLength / 1024 / 1024).toFixed(1)}MB)，跳过:`,
                url.substring(0, 50)
            )
            return { ok: false, mimeType: 'image/jpeg', data: '', error: '图片超出大小上限' }
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length === 0 || buffer.length > HISTORY_IMAGE_MAX_BYTES) {
            return { ok: false, mimeType: 'image/jpeg', data: '', error: '响应体为空或超出大小上限' }
        }

        const magicMime = detectImageMagicBytes(buffer)
        const headerMime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        if (!magicMime && !headerMime.startsWith('image/')) {
            logger.debug('[MediaPreprocess] 响应非图片内容，跳过:', url.substring(0, 50))
            return { ok: false, mimeType: 'image/jpeg', data: '', error: '非图片内容' }
        }

        return { ok: true, mimeType: magicMime || headerMime, data: buffer.toString('base64') }
    } catch (err) {
        const reason = err?.name === 'AbortError' ? '请求超时' : err?.message
        logger.debug('[MediaPreprocess] 图片获取异常:', reason)
        return { ok: false, mimeType: 'image/jpeg', data: '', error: reason }
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * 通过文件头魔数识别图片类型
 * @param {Buffer} buffer - 图片字节
 * @returns {string|null} MIME 类型；无法识别时返回 null
 */
function detectImageMagicBytes(buffer) {
    if (!buffer || buffer.length < 12) return null
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
    if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return 'image/webp'
    }
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
    // HEIC/AVIF 等 ISO-BMFF 容器：偏移 4 起为 'ftyp'，品牌盒区分具体类型
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        const brand = buffer.toString('latin1', 8, 12).toLowerCase()
        if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif'
        if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc')) return 'image/heic'
    }
    return null
}

/**
 * 解析图片获取函数，默认走 fetchHistoryImageBytes；显式注入时以注入实现为准
 * @param {Object} options - 预处理选项
 * @returns {Function} (url) => Promise<{ok: boolean, mimeType: string, data: string, error?: string}>
 */
function resolveImageFetcher(options = {}) {
    if (typeof options.imageFetcher === 'function') return options.imageFetcher
    // 兼容早期注入点：imageDownloader 返回 {mimeType, data, error}，无 ok 字段时按 data 非空判定
    if (typeof options.imageDownloader === 'function') {
        const legacy = options.imageDownloader
        return async url => {
            const result = await legacy(url)
            const ok = result?.ok === true || (!result?.error && !!result?.data)
            return { ok, mimeType: result?.mimeType || 'image/jpeg', data: result?.data || '', error: result?.error }
        }
    }
    return url => fetchHistoryImageBytes(url)
}

/**
 * 解析图片可用性探测函数。图片路径已改为「一次 GET 即判定」，默认不再做独立探测（返回恒真），
 * 仅保留 options.imageAvailabilityProbe 注入点供调用方覆盖。
 * @param {Object} options - 预处理选项
 * @returns {Function|null} (url) => Promise<boolean>；未注入时返回 null
 */
function resolveImageAvailabilityProbe(options = {}) {
    if (typeof options.imageAvailabilityProbe === 'function') return options.imageAvailabilityProbe
    return null
}

/**
 * 处理单张历史图片：rkey 刷新 → 一次 GET 获取字节 → 转 base64。
 * 可用性完全以获取结果为准：刷新失败不再单独探测，而是直接尝试获取，
 * 拿不到有效图片字节即判为不可获取并移除，避免探测与真实可得性不一致导致误删。
 * @param {{url: string, kind: string}} ref - 图片引用
 * @param {Object} ctx - 处理上下文（refresher/bot/canRefresh/fetch/probe/clientType）
 * @returns {Promise<{removed: boolean, value?: Object}>} removed 为 true 表示该图片应被移除
 */
async function resolveOneHistoryImage(ref, ctx) {
    let currentUrl = ref.url
    let refreshed = false
    if (ctx.canRefresh) {
        const refreshResult = await safeRefreshImageUrl(ctx.refresher, currentUrl, ctx.bot)
        // 只接受仍属 QQ 图床域名的新 URL，避免刷新服务返回意外地址
        if (refreshResult?.refreshed === true && isQQPicUrl(refreshResult.url)) {
            currentUrl = refreshResult.url
            refreshed = true
        }
    }
    // 仅保留调用方显式注入的可用性探测点；默认实现已改为「一次 GET 即判定」，不再单独探测
    if (!refreshed && typeof ctx.probe === 'function') {
        const available = await ctx.probe(currentUrl)
        if (!available) {
            logger.debug('[MediaPreprocess] 图片可用性探测未通过，移除:', currentUrl.substring(0, 50))
            return { removed: true }
        }
    }
    try {
        const { ok, mimeType, data, error } = await ctx.fetch(currentUrl)
        if (!ok || !data || error) {
            logger.debug('[MediaPreprocess] 图片不可获取，移除:', currentUrl.substring(0, 50), error || '')
            return { removed: true }
        }
        if (refreshed) logger.debug('[MediaPreprocess] 图片 rkey 刷新成功:', currentUrl.substring(0, 50))
        // image_url 分支保持原有语义：客户端不支持该 mime 时先转码，转码失败降级为文本占位
        if (ref.kind === 'image_url' && ctx.clientType && isUnsupportedImageMime(mimeType, ctx.clientType)) {
            const transcoded = await transcodeImageValueForClient(
                `data:${mimeType};base64,${data}`,
                mimeType,
                ctx.clientType,
                currentUrl.substring(0, 50)
            )
            if (!transcoded) return { removed: false, value: { type: 'text', text: '[不支持的图片已跳过]' } }
            return {
                removed: false,
                value: {
                    type: 'image',
                    image: `data:${transcoded.mimeType};base64,${transcoded.data}`,
                    mimeType: transcoded.mimeType
                }
            }
        }
        return { removed: false, value: { type: 'image', image: `data:${mimeType};base64,${data}` } }
    } catch (err) {
        logger.debug('[MediaPreprocess] 图片获取失败，移除:', err?.message)
        return { removed: true }
    }
}

/**
 * 并发处理历史消息中的 QQ 图床图片（刷新/校验/下载），结果以 content 项对象引用为键
 * @param {Array} histories - 消息历史
 * @param {Object} options - 预处理选项
 * @returns {Promise<Map<Object, {removed: boolean, value?: Object}>>} 处理结果映射
 */
async function resolveHistoryImages(histories, options = {}) {
    const results = new Map()
    if (!Array.isArray(histories) || histories.length === 0) return results
    const refs = collectHistoryImageRefs(histories)
    if (refs.length === 0) return results

    // options.rkeyRefresher 显式传入时优先（传 null 表示禁用刷新）；否则动态加载 rkey 服务
    const refresher = Object.prototype.hasOwnProperty.call(options, 'rkeyRefresher')
        ? options.rkeyRefresher && { refreshImageUrl: options.rkeyRefresher }
        : await loadRkeyRefreshModule()
    // bot 上下文：调用方未透传时回退到 Yunzai 全局 Bot 实例
    const bot = options.bot || globalThis.Bot || null
    const canRefresh = canRefreshWithBot(refresher, bot)
    const probe = resolveImageAvailabilityProbe(options)
    const fetchImage = resolveImageFetcher(options)
    const ctx = { refresher, bot, canRefresh, probe, fetch: fetchImage, clientType: options.clientType || '' }

    const resolved = await mapWithConcurrency(refs, HISTORY_IMAGE_CONCURRENCY, ref => resolveOneHistoryImage(ref, ctx))
    refs.forEach((ref, index) => results.set(ref.item, resolved[index] || { removed: true }))
    logger.debug(
        `[MediaPreprocess] 历史图片处理完成: 共${refs.length}张, 移除${resolved.filter(r => r?.removed).length}张`
    )
    return results
}

/**
 * 根据文件扩展名获取MIME类型
 */
function getMimeType(ext) {
    const mimeTypes = {
        // 图片
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        // 视频
        mp4: 'video/mp4',
        webm: 'video/webm',
        avi: 'video/x-msvideo',
        mov: 'video/quicktime',
        mkv: 'video/x-matroska',
        flv: 'video/x-flv',
        m4v: 'video/x-m4v',
        '3gp': 'video/3gpp',
        // 音频
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        flac: 'audio/flac',
        aac: 'audio/aac',
        // 文档
        pdf: 'application/pdf',
        txt: 'text/plain'
    }
    return mimeTypes[ext?.toLowerCase()]
}

/**
 * 根据客户端类型获取图片发送策略。
 * @param {string} clientType - openai/gemini/claude 等
 * @returns {{supported: string[], target: string, staticFallback: string}}
 */
function getImageSendPolicy(clientType = '') {
    if (clientType === 'gemini') {
        return {
            supported: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heif', 'image/heic'],
            target: 'image/webp',
            staticFallback: 'image/jpeg'
        }
    }
    return {
        supported: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
        target: 'image/png',
        staticFallback: 'image/jpeg'
    }
}

/**
 * 判断 mime 是否为 Gemini 图片白名单外的图片类型。
 */
function isUnsupportedImageMime(mimeType, clientType) {
    if (!mimeType || !mimeType.startsWith('image/')) return false
    const { supported } = getImageSendPolicy(clientType)
    const normalized = mimeType.toLowerCase()
    if (supported.includes(normalized)) return false
    // 图片类型但不在白名单内（gif/bmp/svg/ico/x-icon 等）
    return true
}

/**
 * 根据客户端类型转码图片。
 * @param {Buffer} input - 原始图片二进制
 * @param {string} mimeType - 原始 mime
 * @param {string} clientType
 * @returns {Promise<{mimeType: string, data: Buffer} | null>}
 */
async function transcodeImageForClient(input, mimeType, clientType, label = '') {
    const { supported, target } = getImageSendPolicy(clientType)
    const normalized = mimeType?.toLowerCase()
    if (!normalized || !normalized.startsWith('image/') || supported.includes(normalized)) {
        return { mimeType: normalized, data: input }
    }

    const sharp = (await import('sharp')).default
    try {
        const pipeline = sharp(input).rotate()
        if (normalized === 'image/svg+xml') pipeline.density(300)
        const output = await (target === 'image/webp' ? pipeline.webp() : pipeline.png()).toBuffer({
            resolveWithObject: true
        })
        logger.debug(`[MediaTranscode] ${label || mimeType} -> ${output.info.format} via ${clientType}`)
        return { mimeType: `image/${output.info.format}`, data: output.data }
    } catch (targetErr) {
        try {
            const fallback = await sharp(input).rotate().jpeg().toBuffer({ resolveWithObject: true })
            logger.debug(`[MediaTranscode] ${label || mimeType} 目标格式失败回退静态 JPEG: ${targetErr.message}`)
            return { mimeType: 'image/jpeg', data: fallback.data }
        } catch (fallbackErr) {
            logger.debug(`[MediaTranscode] ${label || mimeType} 转码彻底失败，降级为文本: ${fallbackErr.message}`)
            return null
        }
    }
}

/**
 * 从 data URL 或裸 base64 中按需转码出目标白名单 mime。
 * @param {string} imageValue - data:...;base64,... 或裸 base64
 * @param {string} mimeType
 * @param {string} clientType
 * @param {string} [label]
 * @returns {Promise<{mimeType: string, data: string} | null>}
 */
async function transcodeImageValueForClient(imageValue, mimeType, clientType, label = '') {
    let raw = imageValue
    if (raw.startsWith('data:')) {
        const idx = raw.indexOf(';base64,')
        if (idx === -1) return null
        raw = raw.slice(idx + ';base64,'.length)
    }
    try {
        const buffer = Buffer.from(raw, 'base64')
        const result = await transcodeImageForClient(buffer, mimeType, clientType, label)
        if (!result) return null
        return { mimeType: result.mimeType, data: result.data.toString('base64') }
    } catch (err) {
        logger.debug(`[MediaTranscode] ${label || mimeType} 解码失败: ${err.message}`)
        return null
    }
}

/**
 * 预处理消息中的媒体URL，转换为base64
 * 支持：图片、视频、音频
 * @param {Array} histories - 消息历史
 * @param {Object} options - 选项
 * @param {boolean} [options.processVideo=true] - 是否处理视频
 * @param {boolean} [options.processAudio=true] - 是否处理音频
 * @param {string} [options.clientType=''] - 客户端类型
 * @param {number} [options.maxVideoSize=20*1024*1024] - 最大视频大小(bytes)
 * @param {Object} [options.bot] - Yunzai Bot 实例；缺省时回退到 globalThis.Bot，供 rkey 刷新使用
 * @param {Function} [options.rkeyRefresher] - 自定义 rkey 刷新器；显式传入 null 可禁用刷新
 * @param {Function} [options.imageAvailabilityProbe] - 自定义图片可用性探测函数 (url) => Promise<boolean>；不注入时不做独立探测
 * @param {Function} [options.imageFetcher] - 自定义图片获取函数 (url) => Promise<{ok, mimeType, data, error}>
 * @param {Function} [options.imageDownloader] - 旧版图片下载函数 (url) => Promise<{mimeType, data, error}>，兼容保留
 * @returns {Promise<Array>}
 */
export async function preprocessMediaToBase64(histories, options = {}) {
    const { processVideo = true, processAudio = true, clientType = '', maxVideoSize = 20 * 1024 * 1024 } = options
    const processed = []
    // 阶段一：并发完成 QQ 图床图片的 rkey 刷新 / 可用性校验 / 下载，再按原顺序组装消息
    const historyImageResults = await resolveHistoryImages(histories, options)

    for (const msg of histories) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
            const newContent = []
            for (const item of msg.content) {
                try {
                    if (item.type === 'image' && item.image) {
                        // QQ 图床项已在并发阶段处理完毕：不可用则整项移除，可用则直接采用其结果
                        const resolvedImage = historyImageResults.get(item)
                        if (resolvedImage) {
                            if (resolvedImage.removed) {
                                logger.debug('[MediaPreprocess] 图片不可用已移除:', item.image?.substring(0, 50))
                                continue
                            }
                            newContent.push(resolvedImage.value)
                            continue
                        }
                        if (item.image.startsWith('data:')) {
                            const idx = item.image.indexOf(';base64,')
                            if (idx !== -1) {
                                const mimeType = (item.mimeType || item.image.slice(5, idx)).toLowerCase()
                                if (clientType && isUnsupportedImageMime(mimeType, clientType)) {
                                    const transcoded = await transcodeImageValueForClient(
                                        item.image,
                                        mimeType,
                                        clientType,
                                        mimeType
                                    )
                                    if (transcoded) {
                                        newContent.push({
                                            type: 'image',
                                            image: `data:${transcoded.mimeType};base64,${transcoded.data}`,
                                            mimeType: transcoded.mimeType
                                        })
                                        logger.debug('[MediaTranscode] dataURL图片转码:', mimeType)
                                    } else {
                                        newContent.push({ type: 'text', text: '[不支持的图片已跳过]' })
                                        logger.debug('[MediaTranscode] dataURL图片转码失败降级文本:', mimeType)
                                    }
                                    continue
                                }
                            }
                            newContent.push(item)
                            continue
                        }
                        // 判断是否为原始 base64 数据（非URL格式）
                        const isRawBase64 =
                            !item.image.startsWith('http://') &&
                            !item.image.startsWith('https://') &&
                            !item.image.startsWith('file://') &&
                            !item.image.startsWith('base64://') &&
                            !item.image.startsWith('/')
                        if (isRawBase64) {
                            const mimeType = item.mimeType || 'image/jpeg'
                            if (clientType && isUnsupportedImageMime(mimeType, clientType)) {
                                const transcoded = await transcodeImageValueForClient(
                                    item.image,
                                    mimeType,
                                    clientType,
                                    mimeType
                                )
                                if (transcoded) {
                                    newContent.push({
                                        type: 'image',
                                        image: `data:${transcoded.mimeType};base64,${transcoded.data}`,
                                        mimeType: transcoded.mimeType
                                    })
                                    logger.debug('[MediaTranscode] 原始base64图片转码:', mimeType)
                                } else {
                                    newContent.push({ type: 'text', text: '[不支持的图片已跳过]' })
                                    logger.debug('[MediaTranscode] 图片转码失败降级文本:', mimeType)
                                }
                                continue
                            }
                            newContent.push({
                                type: 'image',
                                image: `data:${mimeType};base64,${item.image}`
                            })
                            logger.debug('[MediaPreprocess] 原始base64图片直接转换:', mimeType)
                        } else {
                            const { mimeType, data, error } = await urlToBase64(item.image, 'image/jpeg')
                            if (data && !error) {
                                newContent.push({
                                    type: 'image',
                                    image: `data:${mimeType};base64,${data}`
                                })
                                logger.debug('[MediaPreprocess] 图片转base64:', item.image?.substring(0, 50))
                            } else {
                                // 图片获取失败，跳过（不添加空数据）
                                logger.debug('[MediaPreprocess] 图片跳过:', item.image?.substring(0, 50))
                            }
                        }
                    }
                    // 处理 image_url 类型
                    else if (
                        item.type === 'image_url' &&
                        item.image_url?.url &&
                        !item.image_url.url.startsWith('data:')
                    ) {
                        // QQ 图床项已在并发阶段处理完毕：不可用则整项移除，可用则直接采用其结果
                        const resolvedImageUrl = historyImageResults.get(item)
                        if (resolvedImageUrl) {
                            if (resolvedImageUrl.removed) {
                                logger.debug(
                                    '[MediaPreprocess] image_url不可用已移除:',
                                    item.image_url.url?.substring(0, 50)
                                )
                                continue
                            }
                            newContent.push(resolvedImageUrl.value)
                            continue
                        }
                        // 兼容 "base64:<原文>" 前缀：剥头还原为原始 URL 或 data URL
                        let imageUrlValue = item.image_url.url
                        if (imageUrlValue.startsWith('base64:')) {
                            const rawValue = imageUrlValue.slice('base64:'.length)
                            if (rawValue.startsWith('data:')) {
                                imageUrlValue = rawValue
                            } else if (
                                /^https?:\/\//i.test(rawValue) ||
                                rawValue.startsWith('file://') ||
                                rawValue.startsWith('/')
                            ) {
                                imageUrlValue = rawValue
                            } else {
                                newContent.push({ type: 'text', text: '[不支持的图片已跳过]' })
                                logger.debug('[MediaPreprocess] 非法base64前缀图片跳过')
                                continue
                            }
                        }
                        const { mimeType, data, error } = await urlToBase64(imageUrlValue, 'image/jpeg')
                        if (data && !error) {
                            if (clientType && isUnsupportedImageMime(mimeType, clientType)) {
                                const transcoded = await transcodeImageValueForClient(
                                    `data:${mimeType};base64,${data}`,
                                    mimeType,
                                    clientType,
                                    item.image_url.url?.substring(0, 50)
                                )
                                if (transcoded) {
                                    newContent.push({
                                        type: 'image',
                                        image: `data:${transcoded.mimeType};base64,${transcoded.data}`,
                                        mimeType: transcoded.mimeType
                                    })
                                    logger.debug(
                                        '[MediaTranscode] image_url转码:',
                                        item.image_url.url?.substring(0, 50)
                                    )
                                } else {
                                    newContent.push({ type: 'text', text: '[不支持的图片已跳过]' })
                                    logger.debug('[MediaTranscode] image_url转码失败降级文本')
                                }
                                continue
                            }
                            newContent.push({
                                type: 'image',
                                image: `data:${mimeType};base64,${data}`
                            })
                            logger.debug('[MediaPreprocess] image_url转base64:', item.image_url.url?.substring(0, 50))
                        } else {
                            logger.debug('[MediaPreprocess] image_url跳过:', item.image_url.url?.substring(0, 50))
                        }
                    }
                    // 处理视频类型
                    else if (processVideo && (item.type === 'video' || item.type === 'video_info')) {
                        const videoUrl = item.url || item.video || item.file
                        if (videoUrl && !videoUrl.startsWith('data:')) {
                            try {
                                const { mimeType, data, error } = await urlToBase64(videoUrl, 'video/mp4')
                                if (!data || error) {
                                    logger.debug('[MediaPreprocess] 视频跳过:', videoUrl?.substring(0, 50))
                                    newContent.push(item)
                                    continue
                                }
                                // 检查大小限制
                                const sizeBytes = (data.length * 3) / 4
                                if (sizeBytes <= maxVideoSize) {
                                    newContent.push({
                                        type: 'video',
                                        video: `data:${mimeType};base64,${data}`,
                                        mimeType
                                    })
                                    logger.debug('[MediaPreprocess] 视频转base64:', videoUrl?.substring(0, 50))
                                } else {
                                    logger.warn(
                                        `[MediaPreprocess] 视频过大(${(sizeBytes / 1024 / 1024).toFixed(1)}MB)，跳过:`,
                                        videoUrl?.substring(0, 50)
                                    )
                                    newContent.push(item) // 保留原始
                                }
                            } catch (err) {
                                logger.warn('[MediaPreprocess] 视频转换失败:', err.message)
                                newContent.push(item)
                            }
                        } else {
                            newContent.push(item)
                        }
                    }
                    // 处理音频类型
                    else if (processAudio && (item.type === 'audio' || item.type === 'record')) {
                        const audioUrl = item.url || item.data || item.file
                        if (audioUrl && typeof audioUrl === 'string' && !audioUrl.startsWith('data:')) {
                            try {
                                const { mimeType, data, error } = await urlToBase64(audioUrl, 'audio/mpeg')
                                if (data && !error) {
                                    newContent.push({
                                        type: 'audio',
                                        data,
                                        format: mimeType.split('/')[1] || 'mp3'
                                    })
                                    logger.debug('[MediaPreprocess] 音频转base64:', audioUrl?.substring(0, 50))
                                } else {
                                    logger.debug('[MediaPreprocess] 音频跳过:', audioUrl?.substring(0, 50))
                                    newContent.push(item)
                                }
                            } catch (err) {
                                logger.debug('[MediaPreprocess] 音频转换失败:', err.message)
                                newContent.push(item)
                            }
                        } else {
                            newContent.push(item)
                        }
                    } else {
                        newContent.push(item)
                    }
                } catch (err) {
                    // 静默处理媒体转换错误
                    logger.debug('[MediaPreprocess] 处理失败:', err.message)
                    newContent.push(item)
                }
            }
            // 图片全部被移除时 content 会变成空数组，空 content 发送给 API 会报错：补一条中性文本占位
            if (newContent.length === 0 && msg.content.length > 0) {
                newContent.push({ type: 'text', text: HISTORY_IMAGE_REMOVED_PLACEHOLDER })
                logger.debug('[MediaPreprocess] content 已空，插入占位文本')
            }
            processed.push({ ...msg, content: newContent })
        } else {
            processed.push(msg)
        }
    }
    return processed
}
/**
 * 预处理消息中的图片URL，转换为base64
 * @param {Array} histories - 消息历史
 * @returns {Promise<Array>}
 */
export async function preprocessImageUrls(histories) {
    return preprocessMediaToBase64(histories, { processVideo: true, processAudio: true })
}

/**
 * 预处理消息中的图片URL，转换为base64，并根据客户端类型进行转码
 * @param {Array} histories - 消息历史
 * @param {string} clientType - openai/gemini/claude
 * @returns {Promise<Array>}
 */
export async function preprocessImageUrlsForClient(histories, clientType = '') {
    return preprocessMediaToBase64(histories, { processVideo: true, processAudio: true, clientType })
}

/**
 * 从消息 content 中提取纯文本
 * content 既可能是内容块数组，也可能是字符串（见 hasMeaningfulContent 的字符串分支），
 * 直接对字符串调用 .filter 会抛 TypeError
 * @param {Array|string|any} content - 消息内容
 * @param {string} [separator='\n'] - 多个文本块的连接符
 * @returns {string} 提取出的文本
 */
export function extractText(content, separator = '\n') {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
        .filter(c => c?.type === 'text')
        .map(c => c.text || '')
        .join(separator)
}

/**
 * 判断是否需要把图片转成 base64 后再随请求发送
 *
 * 优先采用渠道 imageConfig.requiresBase64 的显式声明；未声明时才按模型名推断。
 * 单纯的模型名子串匹配在两个方向上都会出错：
 * - 需要 base64 但模型名不含 gemini 的渠道（如 glm-4v、qwen-vl、聚合网关重命名后的模型）
 *   会被判为不需要，实际发出 URL 导致图片识别失败；
 * - 模型名恰好含 "gemini" 的纯文本模型会被无谓地转 base64，白白放大请求体。
 * 因此渠道可用 imageConfig.requiresBase64 直接给出答案，推断仅作兜底。
 *
 * @param {string} model - 模型名称
 * @param {{ requiresBase64?: boolean }} [imageConfig] - 渠道图片处理配置
 * @returns {boolean} 是否需要 base64 预处理
 */
export function needsBase64Preprocess(model, imageConfig) {
    if (typeof imageConfig?.requiresBase64 === 'boolean') {
        return imageConfig.requiresBase64
    }
    if (!model || typeof model !== 'string') return false
    const lowerModel = model.toLowerCase()
    // 兜底推断：Gemini 系列原生要求 base64
    return lowerModel.includes('gemini')
}

/**
 * 兼容旧函数名
 * @param {string} model - 模型名称
 * @param {{ requiresBase64?: boolean }} [imageConfig] - 渠道图片处理配置
 * @returns {boolean} 是否需要 base64 预处理
 */
export function needsImageBase64Preprocess(model, imageConfig) {
    return needsBase64Preprocess(model, imageConfig)
}

/**
 * 解析本次请求实际使用的模型名
 *
 * 优先级：单次请求指定 > 全局 llm.defaultModel > 适配器兜底常量。
 * 各适配器原先各自写死兜底模型，同一份 GeminiClient 里流式与非流式甚至给出了不同的默认值，
 * 会让"没传 model"这条路径在不同入口打到不同模型上。
 *
 * @param {string|undefined} requestedModel - 单次请求指定的模型
 * @param {string} adapterFallback - 该适配器的最终兜底模型
 * @returns {string} 实际使用的模型名
 */
export function resolveModelName(requestedModel, adapterFallback) {
    if (typeof requestedModel === 'string' && requestedModel.trim()) {
        return requestedModel
    }
    const configuredDefault = config.get('llm.defaultModel')
    if (typeof configuredDefault === 'string' && configuredDefault.trim()) {
        return configuredDefault
    }
    return adapterFallback
}

/**
 * 工具调用限制配置。
 * 当前语义：仅当连续完全一致（工具名+参数都相同）的调用达到
 * maxConsecutiveIdenticalCalls 时判定重复循环并挂起工具，其余轮次/总次数不设上限。
 * maxConsecutiveCalls 与 maxTotalToolCalls 为保留字段，不参与判定。
 * @typedef {Object} ToolCallLimitConfig
 * @property {number} [maxConsecutiveCalls] - 保留字段：不参与当前判定
 * @property {number} [maxConsecutiveIdenticalCalls] - 连续完全一致调用达到该次数后判定重复循环
 * @property {number} [maxTotalToolCalls] - 保留字段：不参与当前判定
 */

/**
 * 工具调用上下文
 * @typedef {Object} ToolCallContext
 * @property {Object} event - Yunzai 事件对象
 * @property {Object} bot - Bot 实例
 * @property {string} userId - 用户ID
 * @property {string} [groupId] - 群组ID
 */

/** 默认工具调用限制 */
const DEFAULT_TOOL_CALL_LIMIT = {
    maxConsecutiveCalls: 10, // 保留字段：当前不参与判定
    maxConsecutiveIdenticalCalls: 4, // 连续完全一致调用（工具名+参数都相同）达到该次数后拦截
    maxTotalToolCalls: 25 // 保留字段：当前不参与判定
}

/**
 * @typedef {import('../types').Feature} Feature
 * @typedef {import('../types').Tool} Tool
 * @typedef {import('../types').ILogger} ILogger
 * @typedef {import('../types').HistoryManager} HistoryManager
 * @typedef {import('../types').ClientType} ClientType
 * @typedef {import('../types').MultipleKeyStrategy} MultipleKeyStrategy
 * @typedef {import('../types').UserMessage} UserMessage
 * @typedef {import('../types').AssistantMessage} AssistantMessage
 * @typedef {import('../types').HistoryMessage} HistoryMessage
 * @typedef {import('../types').IMessage} IMessage
 * @typedef {import('../types').ModelResponse} ModelResponse
 * @typedef {import('../types').ModelUsage} ModelUsage
 * @typedef {import('../types').EmbeddingOption} EmbeddingOption
 * @typedef {import('../types').EmbeddingResult} EmbeddingResult
 * @typedef {import('../types').TextContent} TextContent
 * @typedef {import('../types').ToolCallResult} ToolCallResult
 * @typedef {import('../types').ToolCallResultMessage} ToolCallResultMessage
 */

/**
 * 所有LLM适配器的抽象基类
 */
export class AbstractClient {
    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @param {ChaiteContext} [context]
     */
    constructor(options, context) {
        options = BaseClientOptions.create(options)
        this.features = options.features || []
        this.tools = options.tools || []
        this.baseUrl = options.baseUrl || ''
        this.chatPath = options.chatPath || '' // 自定义对话接口路径（兼容旧格式）
        this.modelsPath = options.modelsPath || '' // 自定义模型列表路径（兼容旧格式）
        this.responsePath = options.responsePath || '' // Responses API 路径（兼容自定义 /responses）
        this.endpoints = options.endpoints || {} // 自定义端点配置 { chat, models, embeddings, images }
        this.apiKey = options.apiKey || ''
        this.multipleKeyStrategy = options.multipleKeyStrategy || MultipleKeyStrategyChoice.RANDOM
        this.logger = options.logger || DefaultLogger
        this.historyManager = options.historyManager || DefaultHistoryManager
        this.context = new ChaiteContext(this.logger)
        this.options = options
        /** @type {ToolCallLimitConfig} */
        this.toolCallLimitConfig = options.toolCallLimitConfig || DEFAULT_TOOL_CALL_LIMIT
        /** @type {Function|null} 工具调用中间消息回调 */
        this.onMessageWithToolCall = options.onMessageWithToolCall || null
        if (context) {
            this.context = context
            this.context.setClient(this)
        }
    }

    /**
     * 解析渠道配置的请求超时（毫秒）
     * @returns {number|undefined} 超时毫秒数
     */
    resolveRequestTimeout() {
        const positiveMs = value => (Number.isFinite(value) && value > 0 ? value : undefined)
        const timeout = this.options?.timeout
        if (typeof timeout === 'number') {
            return positiveMs(timeout)
        }
        const read = positiveMs(timeout?.read)
        const maxTimeout = positiveMs(timeout?.maxTimeout)
        /* 未配置 maxTimeout：完全沿用 read，保持既有行为 */
        if (maxTimeout === undefined) {
            return read
        }
        return read === undefined ? maxTimeout : Math.min(read, maxTimeout)
    }

    /**
     * 主要的发送消息方法
     * @param {UserMessage | undefined} message
     * @param {SendMessageOption | Partial<SendMessageOption>} options
     * @returns {Promise<ModelResponse>}
     */
    async sendMessage(message, options) {
        const debug = this.context.chaite?.getGlobalConfig?.()?.getDebug()
        options = SendMessageOption.create(options)
        if (options.toolChoice === undefined && this.options.toolChoice !== undefined) {
            options.toolChoice = this.options.toolChoice
        }

        const logicFn = async () => {
            this.context.setOptions(options)
            await this.options.ready()

            const apiKey = await getKey(this.apiKey, this.multipleKeyStrategy)
            const histories = options.disableHistoryRead
                ? []
                : await this.historyManager.getHistory(options.parentMessageId, options.conversationId)
            this.context.setHistoryMessages(histories)

            if (!options.conversationId) {
                options.conversationId = crypto.randomUUID()
            }

            let thisRequestMsg

            if (message) {
                const userMsgId = crypto.randomUUID()
                thisRequestMsg = {
                    id: userMsgId,
                    parentId: options.parentMessageId,
                    ...message
                }

                if (!this.isEffectivelyEmptyMessage(thisRequestMsg)) {
                    histories.push(thisRequestMsg)
                } else if (debug) {
                    this.logger.debug('skip sending empty user message to model')
                }
            }

            const requestHistories = this.applyTextOnlyFilter(histories)
            this.context.setHistoryMessages(requestHistories)

            const modelResponse = await this._sendMessage(requestHistories, apiKey, options)

            // 保存用户请求
            if (thisRequestMsg && this.shouldPersistHistory(thisRequestMsg)) {
                await this.historyManager.saveHistory(thisRequestMsg, options.conversationId)
                options.parentMessageId = thisRequestMsg.id
                modelResponse.parentId = thisRequestMsg.id
            }

            if (modelResponse.toolCalls && modelResponse.toolCalls.length > 0) {
                // 可执行调用附加来源身份；unknown/歧义调用必须原样保留到 executeToolCalls，
                // 由其生成同 tool_call_id 的错误结果供模型自纠，不能在历史保存前吞掉。
                const resolvedOrOriginal = modelResponse.toolCalls.map(
                    toolCall => this.resolveExecutableToolCall(toolCall, options) || toolCall
                )
                const uniqueToolCalls = this.deduplicateToolCalls(resolvedOrOriginal)
                if (uniqueToolCalls.length < modelResponse.toolCalls.length) {
                    this.logger.info(
                        `[Tool] 保存前仅去除确定性重复调用: ${modelResponse.toolCalls.length} -> ${uniqueToolCalls.length}`
                    )
                }
                modelResponse.toolCalls = uniqueToolCalls
            }

            // 保存模型响应
            if (this.shouldPersistHistory(modelResponse)) {
                const filteredResponse = this.filterToolCallJsonFromResponse(modelResponse)
                if (filteredResponse.content?.length > 0 || filteredResponse.toolCalls?.length > 0) {
                    await this.historyManager.saveHistory(filteredResponse, options.conversationId)
                }
            }

            options.parentMessageId = modelResponse.id

            // 使用改进的逻辑处理工具调用
            if (modelResponse.toolCalls && modelResponse.toolCalls.length > 0) {
                // 初始化工具调用追踪状态
                this.initToolCallTracking(options)
                const deduplicatedToolCalls = this.deduplicateToolCalls(modelResponse.toolCalls)
                if (deduplicatedToolCalls.length < modelResponse.toolCalls.length) {
                    this.logger.info(
                        `[Tool] 去重后工具调用数: ${modelResponse.toolCalls.length} -> ${deduplicatedToolCalls.length}`
                    )
                }
                const loopSignal = this.updateToolCallTracking(options, deduplicatedToolCalls)
                const filteredToolCalls = deduplicatedToolCalls

                const intermediateTextContent = modelResponse.content?.filter(c => c.type === 'text') || []
                let intermediateText = intermediateTextContent
                    .map(c => c.text)
                    .join('')
                    .trim()
                if (intermediateText) {
                    const { cleanText } = parseXmlToolCalls(intermediateText)
                    intermediateText = cleanText
                }
                if (this.onMessageWithToolCall || options.onMessageWithToolCall) {
                    const callback = options.onMessageWithToolCall || this.onMessageWithToolCall
                    try {
                        await callback({
                            intermediateText, // 中间文本回复（已过滤工具调用JSON）
                            contents: modelResponse.content, // 完整内容
                            toolCalls: deduplicatedToolCalls, // 去重后的工具调用信息
                            isIntermediate: true // 标记为中间消息
                        })
                    } catch (err) {
                        this.logger.warn('[Tool] 中间消息回调错误:', err.message)
                    }
                }

                // 执行工具调用
                const { toolCallResults, toolCallLogs } = await this.executeToolCalls(filteredToolCalls, options)

                // 记录日志
                if (!options._toolCallLogs) options._toolCallLogs = []
                options._toolCallLogs.push(...toolCallLogs)

                // 保存工具调用结果到历史
                const tcMsgId = crypto.randomUUID()
                const toolCallResultMessage = {
                    role: 'tool',
                    content: toolCallResults,
                    id: tcMsgId,
                    parentId: options.parentMessageId
                }
                options.parentMessageId = tcMsgId
                await this.historyManager.saveHistory(toolCallResultMessage, options.conversationId)
                const identicalThreshold =
                    this.toolCallLimitConfig?.maxConsecutiveIdenticalCalls ||
                    DEFAULT_TOOL_CALL_LIMIT.maxConsecutiveIdenticalCalls
                const repeatEnough =
                    loopSignal.exactRepeated === true &&
                    (options._consecutiveIdenticalToolCallCount || 0) >= identicalThreshold

                if (repeatEnough) {
                    options.toolChoice = { type: 'none' }
                    this.logger.info(
                        `[Tool] 检测到重复循环（连续 ${options._consecutiveIdenticalToolCallCount} 次完全一致的调用），请求模型以文本收尾`
                    )
                } else {
                    options.toolChoice = { type: 'auto' }
                }

                // 递归继续对话
                return await this.sendMessage(undefined, options)
            }

            // 无工具调用，重置追踪状态
            this.resetToolCallTracking(options)

            if (options.disableHistorySave) {
                await this.historyManager.deleteConversation(options.conversationId)
            }

            return {
                id: modelResponse.id,
                model: modelResponse.model || options.model,
                contents: modelResponse.content,
                usage: modelResponse.usage,
                toolCallLogs: options._toolCallLogs || [] // 返回工具调用日志
            }
        }

        if (!asyncLocalStorage.getStore()) {
            return asyncLocalStorage.run(this.context, async () => {
                return logicFn()
            })
        } else {
            return logicFn()
        }
    }

    /**
     * Check if message should be persisted
     * @param {HistoryMessage} [message]
     * @returns {boolean}
     */
    shouldPersistHistory(message) {
        if (!message) {
            return false
        }
        if (message.role === 'tool') {
            return this.hasMeaningfulContent(message)
        }
        if (message.role === 'assistant' || message.role === 'user') {
            return this.hasMeaningfulContent(message) || (message.toolCalls?.length ?? 0) > 0
        }
        return true
    }

    /**
     * Check if message is effectively empty
     * @param {IMessage} [message]
     * @returns {boolean}
     */
    isEffectivelyEmptyMessage(message) {
        if (!message) {
            return true
        }
        const hasContent = this.hasMeaningfulContent(message)
        const hasToolCall = (message.toolCalls?.length ?? 0) > 0
        return !hasContent && !hasToolCall
    }

    /**
     * Check if message has meaningful content
     * @param {IMessage} [message]
     * @returns {boolean}
     */
    hasMeaningfulContent(message) {
        if (!message || !message.content) {
            return false
        }
        // 处理字符串格式的 content
        if (typeof message.content === 'string') {
            return message.content.trim().length > 0
        }
        // 处理数组格式的 content
        if (!Array.isArray(message.content) || message.content.length === 0) {
            return false
        }
        return message.content.some(part => this.isMessagePartMeaningful(part))
    }

    /**
     * 仅文本模式下过滤掉非文本内容
     * @param {IMessage[]} [messages]
     * @returns {IMessage[]}
     */
    applyTextOnlyFilter(messages) {
        if (this.options?.imageConfig?.textOnly !== true || !Array.isArray(messages)) {
            return messages
        }

        let removedParts = 0
        const filteredMessages = messages
            .map(message => {
                if (!message || !Array.isArray(message.content)) {
                    return message
                }

                const filteredContent = message.content.filter(part => {
                    const keep = this.isTextOnlyAllowedPart(part)
                    if (!keep) {
                        removedParts++
                    }
                    return keep
                })

                if (filteredContent.length === message.content.length) {
                    return message
                }

                return {
                    ...message,
                    content: filteredContent
                }
            })
            .filter(message => {
                if (!message) {
                    return false
                }
                if (message.role === 'tool') {
                    return true
                }
                if ((message.toolCalls?.length ?? 0) > 0) {
                    return true
                }
                return this.hasMeaningfulContent(message)
            })

        if (removedParts > 0) {
            this.logger.debug(`[TextOnly] 已过滤 ${removedParts} 个非文本内容片段`)
        }

        return filteredMessages
    }

    /**
     * 判断仅文本模式下是否保留当前消息片段
     * @param {import('../types').MessageContent} [part]
     * @returns {boolean}
     */
    isTextOnlyAllowedPart(part) {
        if (!part) {
            return false
        }
        return part.type === 'text' || part.type === 'reasoning' || part.type === 'tool'
    }

    /**
     * Check if message part is meaningful
     * @param {import('../types').MessageContent} [part]
     * @returns {boolean}
     */
    isMessagePartMeaningful(part) {
        if (!part) {
            return false
        }
        switch (part.type) {
            case 'text':
            case 'reasoning': {
                const text = part.text
                return typeof text === 'string' && text.trim().length > 0
            }
            case 'image':
                return Boolean(part.image)
            case 'audio':
                return Boolean(part.data)
            case 'tool':
                return Boolean(part.content)
            default:
                return true
        }
    }

    /**
     * Abstract method to be implemented by subclasses
     * @param {IMessage[]} _histories
     * @param {string} _apiKey
     * @param {SendMessageOption} _options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(_histories, _apiKey, _options) {
        throw new Error('Abstract class not implemented')
    }

    /**
     * Send message with history
     * @param {IMessage[]} history
     * @param {SendMessageOption | Partial<SendMessageOption>} [options]
     * @returns {Promise<IMessage & { usage: ModelUsage }>}
     */
    async sendMessageWithHistory(history, options) {
        const apiKey = await getKey(this.apiKey, this.multipleKeyStrategy || MultipleKeyStrategyChoice.RANDOM)
        return this._sendMessage(this.applyTextOnlyFilter(history), apiKey, SendMessageOption.create(options))
    }

    /**
     * Send message with streaming
     * @param {IMessage[]} history
     * @param {SendMessageOption | Partial<SendMessageOption>} [options]
     * @returns {Promise<AsyncGenerator<string, void, unknown>>}
     */
    async streamMessage(_history, _options) {
        throw new Error('Method not implemented.')
    }

    /**
     * Get embeddings (to be implemented by subclasses that support it)
     * @param {string | string[]} _text
     * @param {EmbeddingOption} _options
     * @returns {Promise<EmbeddingResult>}
     */
    async getEmbedding(_text, _options) {
        throw new Error('Method not implemented.')
    }

    /**
     * List available models from the API
     * @returns {Promise<string[]>}
     */
    async listModels() {
        throw new Error('Method not implemented.')
    }

    /**
     * Get model information
     * @param {string} modelId - Model ID
     * @returns {Promise<Object>}
     */
    async getModelInfo(_modelId) {
        throw new Error('Method not implemented.')
    }

    /**
     * Check if the client supports a specific feature
     * @param {string} feature - Feature name (e.g., 'vision', 'tools', 'streaming')
     * @returns {boolean}
     */
    supportsFeature(feature) {
        return this.features.includes(feature)
    }

    /**
     * Validate API key by making a simple request
     * @returns {Promise<{valid: boolean, error?: string}>}
     */
    async validateApiKey() {
        try {
            await this.listModels()
            return { valid: true }
        } catch (error) {
            return { valid: false, error: error.message }
        }
    }

    /**
     * @param {Object} response - 模型响应
     * @returns {Object} 过滤后的响应
     */
    filterToolCallJsonFromResponse(response) {
        if (!response || !response.content || !Array.isArray(response.content)) {
            return response
        }

        const filteredContent = response.content.filter(item => {
            if (item.type !== 'text' || !item.text) return true

            const text = item.text.trim()

            // 检测纯 JSON 格式的工具调用
            if (text.startsWith('{') && text.endsWith('}')) {
                try {
                    const parsed = JSON.parse(text)
                    if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                        // 检查是否只有 tool_calls 字段
                        const keys = Object.keys(parsed)
                        if (keys.length === 1) return false // 过滤掉
                    }
                } catch {
                    // 不是有效 JSON，保留
                }
            }

            // 检测代码块包裹的工具调用 JSON
            const codeBlockMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
            if (codeBlockMatch) {
                const inner = codeBlockMatch[1].trim()
                if (inner.startsWith('{') && inner.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(inner)
                        if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                            const keys = Object.keys(parsed)
                            if (keys.length === 1) return false
                        }
                    } catch {
                        // 不是有效 JSON，保留
                    }
                }
            }

            return true
        })

        return {
            ...response,
            content: filteredContent
        }
    }

    /**
     * 初始化工具调用追踪状态
     * @param {SendMessageOption} options
     */
    initToolCallTracking(options) {
        if (options._toolCallInitialized) return
        options._toolCallInitialized = true
        options._consecutiveIdenticalToolCallCount = 0
        options._lastToolCallSignature = undefined
        options._toolCallLogs = []
    }

    /**
     * 更新工具调用追踪并检查重复限制。
     * 仅当本轮与上一轮的完全一致签名（工具名+参数逐一相同）相同时累计连续计数；
     * 参数不一致即视为正常推进，不拦截也不告警。
     * @param {SendMessageOption} options
     * @param {Array} toolCalls
     * @returns {{exactRepeated: boolean}} 本轮是否与上一轮完全一致
     */
    updateToolCallTracking(options, toolCalls) {
        // 完全一致签名：工具名+参数逐一相同
        const exactSignature = this.buildToolCallSignature(toolCalls)
        const exactRepeated = options._lastToolCallSignature === exactSignature
        if (exactRepeated) {
            options._consecutiveIdenticalToolCallCount = (options._consecutiveIdenticalToolCallCount || 0) + 1
        } else {
            options._lastToolCallSignature = exactSignature
            options._consecutiveIdenticalToolCallCount = 1
        }

        return { exactRepeated }
    }

    /**
     * 重置工具调用追踪状态
     * @param {SendMessageOption} options
     */
    resetToolCallTracking(options) {
        options._consecutiveIdenticalToolCallCount = 0
        options._lastToolCallSignature = undefined
    }

    /**
     * 去重工具调用（移除同一响应中的重复调用）
     * @param {Array} toolCalls - 原始工具调用列表
     * @returns {Array} 去重后的工具调用列表
     */
    deduplicateToolCalls(toolCalls) {
        if (!toolCalls || toolCalls.length <= 1) return toolCalls

        const deduplicated = []

        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i]
            const prev = deduplicated[deduplicated.length - 1]

            // 只去除连续且完全相同（名称+参数）的调用
            if (prev) {
                const prevSig = this.buildToolCallSignature([prev])
                const curSig = this.buildToolCallSignature([tc])
                if (prevSig === curSig) {
                    this.logger.debug(`[Tool] 去重: 跳过连续相同调用 ${tc.function?.name}`)
                    continue
                }
            }

            deduplicated.push(tc)
        }

        return deduplicated
    }

    /**
     * 构建工具调用签名
     * @param {Array} toolCalls
     * @returns {string}
     */
    buildToolCallSignature(toolCalls) {
        if (!toolCalls || toolCalls.length === 0) return ''

        // 对工具调用进行排序并规范化参数，确保签名的一致性
        const normalizedCalls = toolCalls
            .map(tc => {
                const name = tc.function?.name || tc.name
                let args = tc.function?.arguments || tc.arguments

                // 规范化参数为排序后的 JSON 字符串
                let normalizedArgs = ''
                try {
                    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
                    if (parsedArgs && typeof parsedArgs === 'object') {
                        // 排序 keys 以保证签名一致
                        const sortedArgs = {}
                        Object.keys(parsedArgs)
                            .sort()
                            .forEach(key => {
                                sortedArgs[key] = parsedArgs[key]
                            })
                        normalizedArgs = JSON.stringify(sortedArgs)
                    } else {
                        normalizedArgs = JSON.stringify(parsedArgs)
                    }
                } catch (e) {
                    normalizedArgs = String(args)
                }

                return `${name}:${normalizedArgs}`
            })
            .sort()

        return normalizedCalls.join('|')
    }

    getToolMatchesByName(tools, name) {
        if (!name || !Array.isArray(tools)) return []
        return tools.filter(tool => getToolDefinitionName(tool) === name)
    }

    getToolMatchByIdentity(tools, identity) {
        if (!identity || !Array.isArray(tools)) return null
        return tools.find(tool => getToolIdentity(tool) === identity) || null
    }

    resolveExecutableToolCall(toolCall, options = {}) {
        const name = toolCall?.function?.name || toolCall?.name
        if (!name) {
            this.logger.warn('[Tool] 拒绝无效工具调用: unknown_tool')
            return null
        }

        const availableTools = Array.isArray(this.tools) ? this.tools : []
        const hasExplicitExposedTools = Object.prototype.hasOwnProperty.call(options, '_exposedTools')
        const exposedTools = hasExplicitExposedTools
            ? Array.isArray(options._exposedTools)
                ? options._exposedTools
                : []
            : availableTools
        const identity = getToolIdentity(toolCall)
        const hasExplicitToolCallIdentity = typeof toolCall?.identity === 'string' && toolCall.identity.trim()
        const exposedIdentityMatch = this.getToolMatchByIdentity(exposedTools, identity)
        if (exposedIdentityMatch) {
            const availableIdentityMatch = this.getToolMatchByIdentity(availableTools, identity) || exposedIdentityMatch
            return attachToolMetadata(toolCall, availableIdentityMatch)
        }
        if (hasExplicitExposedTools && hasExplicitToolCallIdentity) {
            this.logger.warn(`[Tool] 拒绝未暴露工具调用: ${name}`)
            return null
        }

        const exposedMatches = this.getToolMatchesByName(exposedTools, name)
        if (exposedMatches.length === 1) {
            const exposedTool = exposedMatches[0]
            const exposedIdentity = getToolIdentity(exposedTool)
            const availableMatch =
                this.getToolMatchByIdentity(availableTools, exposedIdentity) ||
                (this.getToolMatchesByName(availableTools, name).length === 1
                    ? this.getToolMatchesByName(availableTools, name)[0]
                    : null)
            if (availableMatch) return attachToolMetadata(toolCall, availableMatch)
        }

        if (exposedMatches.length > 1) {
            this.logger.warn(`[Tool] 忽略无法唯一定位的工具调用: ${name}`)
            return null
        }

        if (hasExplicitExposedTools) {
            this.logger.warn(`[Tool] 拒绝未暴露工具调用: ${name}`)
            return null
        }

        const availableMatches = this.getToolMatchesByName(availableTools, name)
        if (availableMatches.length === 1) {
            return attachToolMetadata(toolCall, availableMatches[0])
        }
        if (availableMatches.length > 1) {
            this.logger.warn(`[Tool] 忽略无法唯一定位的工具调用: ${name}`)
            return null
        }

        this.logger.warn(`[Tool] 拒绝无效工具调用: ${name}`)
        return null
    }

    resolveExecutableToolCalls(toolCalls, options = {}) {
        const executableToolCalls = []
        for (const toolCall of toolCalls || []) {
            const executableToolCall = this.resolveExecutableToolCall(toolCall, options)
            if (executableToolCall) executableToolCalls.push(executableToolCall)
        }
        return executableToolCalls
    }

    /**
     * @param {Array} toolCalls - 工具调用列表
     * @param {SendMessageOption} options
     * @returns {Promise<{toolCallResults: Array, toolCallLogs: Array}>}
     */
    /**
     * 记录在进入 McpManager 前被拒绝的模型工具尝试。
     * @param {Object} toolCall - 原始工具调用
     * @param {string} reason - 拒绝原因
     * @param {Object} options - 当前请求选项
     * @param {Object} [argsOverride] - 已解析参数
     */
    async recordRejectedToolAttempt(toolCall, reason, options = {}, argsOverride = undefined) {
        const name = toolCall?.function?.name || toolCall?.name || 'unknown_tool'
        let args = argsOverride
        if (args === undefined) {
            args = toolCall?.function?.arguments ?? toolCall?.arguments ?? {}
            if (typeof args === 'string') {
                try {
                    args = JSON.parse(args)
                } catch {
                    args = { _raw: args }
                }
            }
        }
        try {
            const { statsService } = await import('../../services/stats/StatsService.js')
            await statsService.recordToolCallFull({
                toolName: name,
                request: args,
                response: {
                    content: [{ type: 'text', text: reason }],
                    isError: true
                },
                success: false,
                error: reason,
                duration: 0,
                timestamp: Date.now(),
                attemptId: toolCall?.id,
                userId: options.userId || options.event?.user_id,
                groupId: options.groupId || options.event?.group_id,
                source: 'client_preflight'
            })
        } catch (error) {
            this.logger.debug?.(`[Tool] 记录前置拒绝失败: ${error.message}`)
        }
    }

    async executeToolCalls(toolCalls, options) {
        const validToolCalls = []
        const toolCallResults = []
        const toolCallLogs = []

        for (const toolCall of toolCalls || []) {
            const executableToolCall = this.resolveExecutableToolCall(toolCall, options)
            if (executableToolCall) {
                validToolCalls.push(executableToolCall)
                continue
            }

            const displayName = toolCall?.function?.name || toolCall?.name || 'unknown_tool'
            const reason =
                displayName === 'unknown_tool'
                    ? '工具未执行：工具名称缺失'
                    : `工具未执行：未知或无法唯一定位工具 ${displayName}`
            toolCallResults.push({
                tool_call_id: normalizeToolCallIdForResult(toolCall?.id),
                content: JSON.stringify({
                    status: 'error',
                    tool: displayName,
                    content: reason
                }),
                type: 'tool',
                name: displayName,
                mcpContent: [{ type: 'text', text: reason }],
                isError: true
            })
            toolCallLogs.push({
                name: displayName,
                args: {},
                result: reason,
                duration: 0,
                isError: true
            })
            await this.recordRejectedToolAttempt(toolCall, reason, options)
        }

        if (validToolCalls.length === 0) {
            return { toolCallResults, toolCallLogs }
        }

        const preflight = await toolApprovalService.preflight(validToolCalls, {
            ...options,
            availableTools: this.tools
        })
        toolCallResults.push(...preflight.blockedResults.map(item => item.toolResult))
        toolCallLogs.push(...preflight.blockedResults.map(item => item.log))
        for (const blocked of preflight.blockedResults) {
            const sourceCall = validToolCalls.find(item => item?.id && item.id === blocked.toolResult?.tool_call_id)
            await this.recordRejectedToolAttempt(
                sourceCall || { id: blocked.toolResult?.tool_call_id, name: blocked.log?.name },
                blocked.log?.result || '工具未执行',
                options,
                blocked.log?.args || {}
            )
        }
        const approvedToolCalls = preflight.approvedToolCalls || []

        if (approvedToolCalls.length === 0) {
            return { toolCallResults, toolCallLogs }
        }

        const sequentialTools = [
            'send_group_message',
            'send_private_message',
            'send_message',
            'reply_current_message',
            'send_forward_message',
            'send_ai_voice',
            'at_user',
            'poke_user'
        ]
        const sequentialCalls = []
        const parallelCalls = []

        for (const tc of approvedToolCalls) {
            const name = tc.function?.name || tc.name || ''
            if (sequentialTools.includes(name)) {
                sequentialCalls.push(tc)
            } else {
                parallelCalls.push(tc)
            }
        }

        const startTime = Date.now()
        if (parallelCalls.length > 0) {
            const parallelNames = parallelCalls.map(t => t.function?.name || 'unknown').join(', ')
            this.logger.debug(`[Tool] 并行执行: ${parallelNames}`)

            const results = await Promise.allSettled(
                parallelCalls.map(toolCall => this.executeSingleToolCall(toolCall, options))
            )

            for (let i = 0; i < results.length; i++) {
                const result = results[i]
                const toolCall = parallelCalls[i]

                if (result.status === 'fulfilled') {
                    toolCallResults.push(result.value.toolResult)
                    toolCallLogs.push(result.value.log)
                } else {
                    const fcName = toolCall.function?.name || toolCall.name || 'unknown_tool'
                    toolCallResults.push({
                        tool_call_id: normalizeToolCallIdForResult(toolCall.id),
                        content: `执行失败: ${result.reason?.message || 'Unknown error'}`,
                        type: 'tool',
                        name: fcName
                    })
                    toolCallLogs.push({
                        name: fcName,
                        args: {},
                        result: `执行失败: ${result.reason?.message || 'Unknown error'}`,
                        duration: 0,
                        isError: true
                    })
                }
            }
        }
        if (sequentialCalls.length > 0) {
            const seqNames = sequentialCalls.map(t => t.function?.name || 'unknown').join(', ')
            this.logger.debug(`[Tool] 串行执行(保序): ${seqNames}`)

            for (const toolCall of sequentialCalls) {
                const { toolResult, log } = await this.executeSingleToolCall(toolCall, options)
                toolCallResults.push(toolResult)
                toolCallLogs.push(log)
                if (sequentialCalls.length > 1) {
                    await new Promise(r => setTimeout(r, 100))
                }
            }
        }

        const totalDuration = Date.now() - startTime
        this.logger.debug(
            `[Tool] 执行完成: ${totalDuration}ms (并行:${parallelCalls.length} 串行:${sequentialCalls.length} 拦截:${preflight.blockedResults.length})`
        )

        return { toolCallResults, toolCallLogs }
    }

    /**
     * 执行单个工具调用
     * @param {Object} toolCall - 工具调用对象
     * @returns {Promise<{toolResult: Object, log: Object}>}
     */
    async executeSingleToolCall(toolCall, options = {}) {
        const toolName = toolCall.function?.name || toolCall.name || 'unknown_tool'
        const startedAt = Date.now()
        let toolArgs = toolCall.function?.arguments ?? toolCall.arguments ?? {}

        if (typeof toolArgs === 'string') {
            try {
                toolArgs = JSON.parse(toolArgs)
            } catch (error) {
                const reason = `arguments 不是合法 JSON: ${error.message}`
                await this.recordRejectedToolAttempt(toolCall, reason, options, { _raw: toolArgs })
                const normalized = normalizeToolExecutionResult(
                    {
                        content: [{ type: 'text', text: reason }],
                        isError: true
                    },
                    { toolName, duration: Date.now() - startedAt }
                )
                return {
                    toolResult: {
                        tool_call_id: normalizeToolCallIdForResult(toolCall.id),
                        content: normalized.providerContent,
                        type: 'tool',
                        name: toolName,
                        mcpContent: normalized.mcpContent,
                        structuredContent: normalized.structuredContent,
                        isError: true
                    },
                    log: {
                        name: toolName,
                        args: { _raw: toolCall.function?.arguments ?? toolCall.arguments },
                        result: sanitizeToolResultForLog(normalized),
                        duration: Date.now() - startedAt,
                        isError: true
                    }
                }
            }
        }

        if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
            const reason = 'arguments 必须是 JSON 对象'
            await this.recordRejectedToolAttempt(toolCall, reason, options, { _raw: toolArgs })
            const normalized = normalizeToolExecutionResult(
                {
                    content: [{ type: 'text', text: reason }],
                    isError: true
                },
                { toolName, duration: Date.now() - startedAt }
            )
            return {
                toolResult: {
                    tool_call_id: normalizeToolCallIdForResult(toolCall.id),
                    content: normalized.providerContent,
                    type: 'tool',
                    name: toolName,
                    mcpContent: normalized.mcpContent,
                    structuredContent: normalized.structuredContent,
                    isError: true
                },
                log: {
                    name: toolName,
                    args: { _raw: toolArgs },
                    result: sanitizeToolResultForLog(normalized),
                    duration: Date.now() - startedAt,
                    isError: true
                }
            }
        }

        const toolIdentity = getToolIdentity(toolCall)
        let tool = toolIdentity ? this.tools.find(item => getToolIdentity(item) === toolIdentity) : null
        if (!tool) {
            const matches = this.getToolMatchesByName(this.tools, toolName)
            tool = matches.length === 1 ? matches[0] : null
        }

        if (!tool) {
            const reason = `工具 "${toolName}" 不存在或未启用`
            // 正常 executeToolCalls 会在更早处记录未知工具；此分支只覆盖直接调用。
            const normalized = normalizeToolExecutionResult(
                {
                    content: [{ type: 'text', text: reason }],
                    isError: true
                },
                { toolName, duration: Date.now() - startedAt }
            )
            return {
                toolResult: {
                    tool_call_id: normalizeToolCallIdForResult(toolCall.id),
                    content: normalized.providerContent,
                    type: 'tool',
                    name: toolName,
                    mcpContent: normalized.mcpContent,
                    structuredContent: normalized.structuredContent,
                    isError: true
                },
                log: {
                    name: toolName,
                    args: toolArgs,
                    result: reason,
                    duration: Date.now() - startedAt,
                    isError: true
                }
            }
        }

        let rawResult
        try {
            rawResult = await tool.run(toolArgs, this.context)
        } catch (error) {
            rawResult = {
                content: [{ type: 'text', text: error.message }],
                isError: true
            }
        }

        const normalized = normalizeToolExecutionResult(rawResult, {
            toolName,
            duration: Date.now() - startedAt
        })
        return {
            toolResult: {
                tool_call_id: normalizeToolCallIdForResult(toolCall.id),
                content: normalized.providerContent,
                type: 'tool',
                name: toolName,
                mcpContent: normalized.mcpContent,
                ...(normalized.structuredContent !== undefined
                    ? { structuredContent: normalized.structuredContent }
                    : {}),
                isError: normalized.isError
            },
            log: {
                name: toolName,
                args: toolArgs,
                result: sanitizeToolResultForLog({
                    content: normalized.mcpContent,
                    structuredContent: normalized.structuredContent,
                    isError: normalized.isError
                }),
                duration: Date.now() - startedAt,
                isError: normalized.isError
            }
        }
    }

    /**
     * 设置工具调用限制配置
     * @param {ToolCallLimitConfig} config
     */
    setToolCallLimitConfig(config) {
        this.toolCallLimitConfig = { ...DEFAULT_TOOL_CALL_LIMIT, ...config }
    }

    /**
     * 设置工具调用中间消息回调
     * @param {Function} callback - (content, toolCalls) => Promise<void>
     */
    setOnMessageWithToolCall(callback) {
        this.onMessageWithToolCall = callback
    }
}
