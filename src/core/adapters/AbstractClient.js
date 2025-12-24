import crypto from 'node:crypto'
import { BaseClientOptions, ChaiteContext, DefaultLogger, MultipleKeyStrategyChoice, SendMessageOption } from '../types/index.js'
import DefaultHistoryManager from '../utils/history.js'
import { asyncLocalStorage, extractClassName, getKey } from '../utils/index.js'
import { logService } from '../../services/stats/LogService.js'

/**
 * 生成工具调用ID
 */
function generateToolId(prefix = 'tool') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

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
        } catch {
        }
        let fixed = str
        if ((fixed.startsWith('"') && fixed.endsWith('"')) || 
            (fixed.startsWith("'") && fixed.endsWith("'"))) {
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
        } catch {
        }
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
    const fixMalformedJson = (jsonStr) => {
        let fixed = jsonStr
        fixed = fixed.replace(/"arguments"\s*:\s*"(\{(?:[^"\\]|\\.)*\})(\}+)"/g, (match, validJson, extraBraces) => {
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
                            tc.function.arguments = args
                                .replace(/^"/, '').replace(/"$/, '')
                                .replace(/\\"/g, '"')
                        }
                    }
                }
                return JSON.stringify(parsed)
            }
        } catch {
        }
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
                        const funcName = item.function?.name || item.name
                        const funcArgs = item.function?.arguments || item.arguments
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
            } catch {
            }
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
                    } catch {
                    }
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
                            const funcName = item.function?.name || item.name
                            const funcArgs = item.function?.arguments || item.arguments
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
                } catch {
                }
            }
        }
        const singleToolRegex = /\{\s*"(?:name|function)"\s*:\s*"([^"]+)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*?\}|\"[^"]*\")\s*\}/g
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
        const escapedArgsPattern = /"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,\s*"arguments"\s*:\s*"(\{(?:[^"\\]|\\.|"(?:[^"\\]|\\.)*")*\})"/g
        let escapedMatch
        while ((escapedMatch = escapedArgsPattern.exec(cleanText)) !== null) {
            const funcName = escapedMatch[1]
            let funcArgs = escapedMatch[2]
            if (funcName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(funcName) && funcName.length >= 2) {
                try {
                    funcArgs = JSON.parse(`"${funcArgs}"`)
                } catch {
                }
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
            /\bname\s*[:=]\s*["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?[\s\S]*?\barguments\s*[:=]\s*(\{[\s\S]*?\}|["'][^"']*["'])/gi,
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
            const excludeNames = ['if', 'for', 'while', 'switch', 'function', 'return', 'console', 'log', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math', 'Error']
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
                } catch {
                }
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
        /^```(?:json)?\s*[\s\S]*```$/i,
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
    
    // 工具调用数量限制和去重
    const MAX_TOOL_CALLS = 10
    if (toolCalls.length > 0) {
        const seen = new Set()
        const deduped = []
        for (const tc of toolCalls) {
            const sig = `${tc.function.name}:${tc.function.arguments}`
            if (!seen.has(sig)) {
                seen.add(sig)
                deduped.push(tc)
            }
        }
        if (deduped.length > MAX_TOOL_CALLS) {
            logger.warn(`[Tool Parser] 工具调用数量 ${deduped.length} 超过限制 ${MAX_TOOL_CALLS}，截断`)
            deduped.length = MAX_TOOL_CALLS
        }
        
        if (deduped.length !== toolCalls.length) {
            logger.debug(`[Tool Parser] 去重: ${toolCalls.length} -> ${deduped.length}`)
        }
        cleanText = cleanText
            .replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/g, '')
            .replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*$/g, '')  // 被截断的情况
            .replace(/^\s*\[\s*\{[\s\S]*?"function"[\s\S]*?\}\s*\]\s*$/g, '')  // 纯工具调用数组
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            try {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), URL_TO_BASE64_CONFIG.timeout)
                
                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': URL_TO_BASE64_CONFIG.userAgent,
                        'Accept': '*/*',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Referer': new URL(url).origin + '/',
                    }
                })
                
                clearTimeout(timeoutId)
                
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
                const is4xxError = (fetchErr.status >= 400 && fetchErr.status < 500) ||
                    /HTTP\s*4\d{2}/i.test(fetchErr.message)
                
                // QQ 多媒体 URL 过期是常见情况，完全静默
                const isQQMedia = url.includes('multimedia.nt.qq.com.cn') || 
                    url.includes('gchat.qpic.cn') ||
                    url.includes('c2cpicdw.qpic.cn')
                
                if (is4xxError || isQQMedia) {
                    // 静默处理，只记录 debug 日志
                    logger.debug(`[urlToBase64] 媒体获取失败(${fetchErr.status || '4xx'})，跳过: ${url.substring(0, 60)}...`)
                    break
                }
                
                // 其他错误（5xx、网络等）才重试
                if (attempt < maxRetries) {
                    logger.debug(`[urlToBase64] 第${attempt + 1}次获取失败，${retryDelay}ms后重试: ${fetchErr.message}`)
                    await new Promise(r => setTimeout(r, retryDelay))
                }
            }
        }
        
        // 所有重试都失败
        if (lastError) {
            // 检测客户端错误或 QQ 媒体 URL
            const is4xxError = (lastError.status >= 400 && lastError.status < 500) ||
                /HTTP\s*4\d{2}/i.test(lastError.message)
            const isQQMedia = url.includes('multimedia.nt.qq.com.cn') || 
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
        const err = new Error(`获取媒体文件失败 (${URL_TO_BASE64_CONFIG.maxRetries + 1}次尝试): ${lastError?.message || '未知错误'}`)
        err.logged = true
        throw err
        
    } catch (error) {
        // 只记录未标记的错误
        if (!error.logged) {
            // 再次检查是否为 QQ 媒体 URL 的 4xx 错误
            const is4xxError = /HTTP\s*4\d{2}/i.test(error.message)
            const isQQMedia = url.includes('multimedia.nt.qq.com.cn') || 
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

/**
 * 根据文件扩展名获取MIME类型
 */
function getMimeType(ext) {
    const mimeTypes = {
        // 图片
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
        'svg': 'image/svg+xml', 'ico': 'image/x-icon',
        // 视频
        'mp4': 'video/mp4', 'webm': 'video/webm', 'avi': 'video/x-msvideo',
        'mov': 'video/quicktime', 'mkv': 'video/x-matroska', 'flv': 'video/x-flv',
        'm4v': 'video/x-m4v', '3gp': 'video/3gpp',
        // 音频
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
        'm4a': 'audio/mp4', 'flac': 'audio/flac', 'aac': 'audio/aac',
        // 文档
        'pdf': 'application/pdf', 'txt': 'text/plain',
    }
    return mimeTypes[ext?.toLowerCase()]
}

/**
 * 预处理消息中的媒体URL，转换为base64
 * 支持：图片、视频、音频
 * @param {Array} histories - 消息历史
 * @param {Object} options - 选项
 * @param {boolean} [options.processVideo=true] - 是否处理视频
 * @param {boolean} [options.processAudio=true] - 是否处理音频
 * @param {number} [options.maxVideoSize=20*1024*1024] - 最大视频大小(bytes)
 * @returns {Promise<Array>}
 */
export async function preprocessMediaToBase64(histories, options = {}) {
    const { processVideo = true, processAudio = true, maxVideoSize = 20 * 1024 * 1024 } = options
    const processed = []
    
    for (const msg of histories) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
            const newContent = []
            for (const item of msg.content) {
                try {
                    // 处理 image 类型
                    if (item.type === 'image' && item.image && !item.image.startsWith('data:')) {
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
                    // 处理 image_url 类型
                    else if (item.type === 'image_url' && item.image_url?.url && !item.image_url.url.startsWith('data:')) {
                        const { mimeType, data, error } = await urlToBase64(item.image_url.url, 'image/jpeg')
                        if (data && !error) {
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
                                    logger.warn(`[MediaPreprocess] 视频过大(${(sizeBytes/1024/1024).toFixed(1)}MB)，跳过:`, videoUrl?.substring(0, 50))
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
                    }
                    else {
                        newContent.push(item)
                    }
                } catch (err) {
                    // 静默处理媒体转换错误
                    logger.debug('[MediaPreprocess] 处理失败:', err.message)
                    newContent.push(item)
                }
            }
            processed.push({ ...msg, content: newContent })
        } else {
            processed.push(msg)
        }
    }
    return processed
}
export async function preprocessImageUrls(histories) {
    return preprocessMediaToBase64(histories, { processVideo: true, processAudio: true })
}

/**
 * @param {string} model - 模型名称
 * @returns {boolean}
 */
export function needsBase64Preprocess(model) {
    if (!model || typeof model !== 'string') return false
    const lowerModel = model.toLowerCase()
    // Gemini 系列模型都需要 base64
    return lowerModel.includes('gemini')
}

/**
 * 兼容旧函数名
 */
export function needsImageBase64Preprocess(model) {
    return needsBase64Preprocess(model)
}

/**
 * 工具调用限制配置
 * @typedef {Object} ToolCallLimitConfig
 * @property {number} [maxConsecutiveCalls] - 最大连续调用次数
 * @property {number} [maxConsecutiveIdenticalCalls] - 最大连续相同调用次数
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
    maxConsecutiveCalls: 10,          // 最大连续调用次数（提高以支持复杂任务）
    maxConsecutiveIdenticalCalls: 4,  // 最大连续完全相同调用次数（工具名+参数都相同）
    maxTotalToolCalls: 25             // 单次对话最大工具调用总数
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
     * 主要的发送消息方法
     * @param {UserMessage | undefined} message
     * @param {SendMessageOption | Partial<SendMessageOption>} options
     * @returns {Promise<ModelResponse>}
     */
    async sendMessage(message, options) {
        const debug = this.context.chaite?.getGlobalConfig?.()?.getDebug()
        options = SendMessageOption.create(options)

        const logicFn = async () => {
            this.context.setOptions(options)
            await this.options.ready()

            const apiKey = await getKey(this.apiKey, this.multipleKeyStrategy)
            const histories = options.disableHistoryRead ? [] : await this.historyManager.getHistory(options.parentMessageId, options.conversationId)
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
                    ...message,
                }

                if (!this.isEffectivelyEmptyMessage(thisRequestMsg)) {
                    histories.push(thisRequestMsg)
                } else if (debug) {
                    this.logger.debug('skip sending empty user message to model')
                }
            }

            const modelResponse = await this._sendMessage(histories, apiKey, options)

            // 保存用户请求
            if (thisRequestMsg && this.shouldPersistHistory(thisRequestMsg)) {
                await this.historyManager.saveHistory(thisRequestMsg, options.conversationId)
                options.parentMessageId = thisRequestMsg.id
                modelResponse.parentId = thisRequestMsg.id
            }

            // 保存模型响应
            if (this.shouldPersistHistory(modelResponse)) {
                const filteredResponse = this.filterToolCallJsonFromResponse(modelResponse)
                // 过滤后内容不为空才保存
                if (filteredResponse.content?.length > 0) {
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
                    this.logger.info(`[Tool] 去重后工具调用数: ${modelResponse.toolCalls.length} -> ${deduplicatedToolCalls.length}`)
                }
                
                // 检查工具调用限制（使用去重后的列表）
                const limitReason = this.updateToolCallTracking(options, deduplicatedToolCalls)
                if (limitReason) {
                    this.resetToolCallTracking(options)
                    
                    // 如果已有文本内容，返回它；否则返回限制提示
                    const textContent = modelResponse.content?.filter(c => c.type === 'text').map(c => c.text).join('') || ''
                    return {
                        id: modelResponse.id,
                        model: options.model,
                        contents: textContent ? modelResponse.content : [{ type: 'text', text: limitReason }],
                        usage: modelResponse.usage,
                        toolCallLogs: options._toolCallLogs || [],
                    }
                }
                
                const intermediateTextContent = modelResponse.content?.filter(c => c.type === 'text') || []
                let intermediateText = intermediateTextContent.map(c => c.text).join('').trim()
                if (intermediateText) {
                    const { cleanText } = parseXmlToolCalls(intermediateText)
                    intermediateText = cleanText
                }
                if (this.onMessageWithToolCall || options.onMessageWithToolCall) {
                    const callback = options.onMessageWithToolCall || this.onMessageWithToolCall
                    try {
                        await callback({
                            intermediateText,           // 中间文本回复（已过滤工具调用JSON）
                            contents: modelResponse.content,  // 完整内容
                            toolCalls: deduplicatedToolCalls,  // 去重后的工具调用信息
                            isIntermediate: true       // 标记为中间消息
                        })
                    } catch (err) {
                        this.logger.warn('[Tool] 中间消息回调错误:', err.message)
                    }
                }

                // 执行工具调用
                const { toolCallResults, toolCallLogs } = await this.executeToolCalls(
                    deduplicatedToolCalls,
                    options
                )

                // 记录日志
                if (!options._toolCallLogs) options._toolCallLogs = []
                options._toolCallLogs.push(...toolCallLogs)

                // 保存工具调用结果到历史
                const tcMsgId = crypto.randomUUID()
                const toolCallResultMessage = {
                    role: 'tool',
                    content: toolCallResults,
                    id: tcMsgId,
                    parentId: options.parentMessageId,
                }
                options.parentMessageId = tcMsgId
                await this.historyManager.saveHistory(toolCallResultMessage, options.conversationId)

                // 追踪工具调用轮次（用于决定是否禁用工具）
                if (!options._toolCallCount) options._toolCallCount = 0
                options._toolCallCount++
                
                // 检测模型类型，Gemini 模型更容易陷入循环
                const modelStr = typeof options.model === 'string' ? options.model : ''
                const isGeminiModel = modelStr.toLowerCase().includes('gemini')
                // 提高多轮工具调用限制，允许更复杂的工具调用链
                const maxBeforeDisable = isGeminiModel ? 6 : 10
                
                // 连续调用超过阈值时禁用工具，防止无限循环
                if (options._toolCallCount >= maxBeforeDisable) {
                    options.toolChoice = { type: 'none' }
                    this.logger.info(`[Tool] 工具调用轮次达到上限 ${maxBeforeDisable}，禁用工具以完成响应`)
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
                model: options.model,
                contents: modelResponse.content,
                usage: modelResponse.usage,
                toolCallLogs: options._toolCallLogs || [], // 返回工具调用日志
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
        return this._sendMessage(history, apiKey, SendMessageOption.create(options))
    }

    /**
     * Send message with streaming
     * @param {IMessage[]} history
     * @param {SendMessageOption | Partial<SendMessageOption>} [options]
     * @returns {Promise<AsyncGenerator<string, void, unknown>>}
     */
    async streamMessage(history, options) {
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
    async getModelInfo(modelId) {
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
        options._consecutiveToolCallCount = 0
        options._consecutiveIdenticalToolCallCount = 0
        options._consecutiveSimilarToolCallCount = 0
        options._totalToolCallCount = 0
        options._lastToolCallSignature = undefined
        options._lastSimplifiedSignature = undefined
        options._toolCallSignatureHistory = new Map()
        options._simplifiedSignatureHistory = new Map()  // 用于检测功能相似的调用
        options._successfulToolCalls = new Set()  // 追踪已成功执行的工具调用
        options._toolCallLogs = []
    }

    /**
     * 更新工具调用追踪并检查限制
     * @param {SendMessageOption} options
     * @param {Array} toolCalls
     * @returns {string|undefined} 如果超过限制返回原因
     */
    updateToolCallTracking(options, toolCalls) {
        const limitConfig = this.toolCallLimitConfig
        if (!limitConfig) return undefined

        // 递增连续调用计数
        options._consecutiveToolCallCount = (options._consecutiveToolCallCount || 0) + 1
        
        // 递增总调用计数
        options._totalToolCallCount = (options._totalToolCallCount || 0) + toolCalls.length

        // 检查最大连续调用次数
        if (limitConfig.maxConsecutiveCalls && options._consecutiveToolCallCount > limitConfig.maxConsecutiveCalls) {
            return `工具调用轮次超过限制(${limitConfig.maxConsecutiveCalls})，已自动停止`
        }
        
        // 检查总调用次数
        if (limitConfig.maxTotalToolCalls && options._totalToolCallCount > limitConfig.maxTotalToolCalls) {
            return `工具调用总次数超过限制(${limitConfig.maxTotalToolCalls})，已自动停止`
        }
        const signature = this.buildToolCallSignature(toolCalls)
        
        // 检查是否与上次调用完全相同
        if (options._lastToolCallSignature === signature) {
            options._consecutiveIdenticalToolCallCount = (options._consecutiveIdenticalToolCallCount || 0) + 1
            this.logger.warn(`[Tool] 检测到完全相同的重复调用 #${options._consecutiveIdenticalToolCallCount}`)
        } else {
            options._lastToolCallSignature = signature
            options._consecutiveIdenticalToolCallCount = 1
        }
        if (limitConfig.maxConsecutiveIdenticalCalls && 
            options._consecutiveIdenticalToolCallCount > limitConfig.maxConsecutiveIdenticalCalls) {
            return `检测到连续${options._consecutiveIdenticalToolCallCount}次完全相同的工具调用，已自动停止`
        }
        if (!options._toolCallSignatureHistory) {
            options._toolCallSignatureHistory = new Map()
        }
        const prevCount = options._toolCallSignatureHistory.get(signature) || 0
        options._toolCallSignatureHistory.set(signature, prevCount + 1)
        if (prevCount >= 5) {
            return `工具调用"${toolCalls[0]?.function?.name}"已重复${prevCount + 1}次（完全相同的参数），检测到循环调用`
        }
        if (toolCalls.length > 1) {
            const callSignatures = toolCalls.map(tc => `${tc.function?.name}:${tc.function?.arguments}`)
            const uniqueSignatures = new Set(callSignatures)
            if (uniqueSignatures.size < toolCalls.length) {
                this.logger.warn(`[Tool] 检测到同一响应中的重复工具调用，去重处理`)
            }
        }

        return undefined
    }

    /**
     * 重置工具调用追踪状态
     * @param {SendMessageOption} options
     */
    resetToolCallTracking(options) {
        options._consecutiveToolCallCount = 0
        options._consecutiveIdenticalToolCallCount = 0
        options._consecutiveSimilarToolCallCount = 0
        options._totalToolCallCount = 0
        options._lastToolCallSignature = undefined
        options._lastSimplifiedSignature = undefined
        options._toolCallSignatureHistory?.clear()
        options._simplifiedSignatureHistory?.clear()
        options._successfulToolCalls?.clear()
    }

    /**
     * 去重工具调用（移除同一响应中的重复调用）
     * @param {Array} toolCalls - 原始工具调用列表
     * @returns {Array} 去重后的工具调用列表
     */
    deduplicateToolCalls(toolCalls) {
        if (!toolCalls || toolCalls.length <= 1) return toolCalls
        
        const seen = new Map()
        const deduplicated = []
        
        for (const tc of toolCalls) {
            // 使用简化签名来检测功能相同的调用
            const sig = this.buildSimplifiedSignature([tc])
            if (!seen.has(sig)) {
                seen.set(sig, true)
                deduplicated.push(tc)
            } else {
                this.logger.warn(`[Tool] 去重: 移除重复调用 ${tc.function?.name}`)
            }
        }
        
        return deduplicated
    }

    /**
     * 构建工具调用签名
     * @param {Array} toolCalls
     * @returns {string}
     */
    buildToolCallSignature(toolCalls) {
        return JSON.stringify(toolCalls.map(tc => ({
            name: tc.function?.name,
            arguments: tc.function?.arguments,
        })))
    }

    /**
     * @param {Array} toolCalls
     * @returns {string}
     */
    buildSimplifiedSignature(toolCalls) {
        return toolCalls.map(tc => {
            const name = tc.function?.name || ''
            let args = tc.function?.arguments
            if (typeof args === 'string') {
                try { args = JSON.parse(args) } catch { args = {} }
            }
            args = args || {}
            if (name === 'execute_command' && args.command) {
                let cmd = args.command.trim().toLowerCase()
                cmd = cmd.replace(/^(rmdir|rd)\s+/i, 'DELETE_DIR ')
                cmd = cmd.replace(/^(dir|ls)\s*/i, 'LIST ')
                return `${name}:${cmd}`
            }
            const batchTools = [
                'send_group_message', 'send_private_message', 'send_message',
                'poke_user', 'at_user', 'set_group_card', 'set_group_ban',
                'kick_group_member', 'send_ai_voice'
            ]
            if (batchTools.includes(name)) {
                const targetId = args.group_id || args.user_id || args.target_id || ''
                return `${name}:${targetId}:${JSON.stringify(args)}`
            }
            return `${name}:${JSON.stringify(args)}`
        }).join('|')
    }

    /**
     * @param {Array} toolCalls - 工具调用列表
     * @param {SendMessageOption} options
     * @returns {Promise<{toolCallResults: Array, toolCallLogs: Array}>}
     */
    async executeToolCalls(toolCalls, options) {
        const toolCallResults = []
        const toolCallLogs = []
        const sequentialTools = [
            'send_group_message', 'send_private_message', 'send_message',
            'reply_current_message', 'send_forward_message', 'send_ai_voice',
            'at_user', 'poke_user'
        ]
        const sequentialCalls = []
        const parallelCalls = []
        
        for (const tc of toolCalls) {
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
                parallelCalls.map(toolCall => this.executeSingleToolCall(toolCall))
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
                        tool_call_id: toolCall.id,
                        content: `执行失败: ${result.reason?.message || 'Unknown error'}`,
                        type: 'tool',
                        name: fcName,
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
                const { toolResult, log } = await this.executeSingleToolCall(toolCall)
                toolCallResults.push(toolResult)
                toolCallLogs.push(log)
                if (sequentialCalls.length > 1) {
                    await new Promise(r => setTimeout(r, 100))
                }
            }
        }
        
        const totalDuration = Date.now() - startTime
        this.logger.debug(`[Tool] 执行完成: ${totalDuration}ms (并行:${parallelCalls.length} 串行:${sequentialCalls.length})`)

        return { toolCallResults, toolCallLogs }
    }

    /**
     * 执行单个工具调用
     * @param {Object} toolCall - 工具调用对象
     * @returns {Promise<{toolResult: Object, log: Object}>}
     */
    async executeSingleToolCall(toolCall) {
        const fcName = toolCall.function?.name || toolCall.name || 'unknown_tool'
        let fcArgs = toolCall.function?.arguments || toolCall.arguments
        
        // 解析参数
        if (typeof fcArgs === 'string') {
            try {
                fcArgs = JSON.parse(fcArgs)
            } catch (e) {
                fcArgs = {}
            }
        }

        const tool = this.tools.find(t => t.function?.name === fcName || t.name === fcName)

        if (tool) {
            const startTime = Date.now()
            let toolResult
            let isError = false

            try {
                toolResult = await tool.run(fcArgs, this.context)
                if (typeof toolResult !== 'string') {
                    toolResult = JSON.stringify(toolResult)
                }
            } catch (err) {
                toolResult = `执行失败: ${err.message}`
                isError = true
            }

            const duration = Date.now() - startTime

            return {
                toolResult: {
                    tool_call_id: toolCall.id,
                    content: toolResult,
                    type: 'tool',
                    name: fcName,
                },
                log: {
                    name: fcName,
                    args: fcArgs,
                    result: toolResult.length > 500 ? toolResult.substring(0, 500) + '...' : toolResult,
                    duration,
                    isError
                }
            }
        } else {
            return {
                toolResult: {
                    tool_call_id: toolCall.id,
                    content: `工具 "${fcName}" 不存在或未启用`,
                    type: 'tool',
                    name: fcName,
                },
                log: {
                    name: fcName,
                    args: fcArgs,
                    result: '工具不存在',
                    duration: 0,
                    isError: true
                }
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
