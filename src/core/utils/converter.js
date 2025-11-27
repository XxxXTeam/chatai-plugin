/**
 * @typedef {import('../types/models').IMessage} IMessage
 * @typedef {import('../types/tools').Tool} Tool
 * @typedef {import('@google/genai').Content} Content
 * @typedef {import('@google/genai').FunctionDeclaration} FunctionDeclaration
 * @typedef {import('@google/genai').GenerateContentResponse} GenerateContentResponse
 * @typedef {import('openai').OpenAI.ChatCompletionMessageParam} ChatCompletionMessageParam
 * @typedef {import('openai').OpenAI.ChatCompletionTool} ChatCompletionTool
 * @typedef {import('@anthropic-ai/sdk').Anthropic.MessageParam} MessageParam
 * @typedef {import('@anthropic-ai/sdk').Anthropic.ToolUnion} ToolUnion
 */

class IntoChaiteConverterEntry {
    openai
    gemini
    claude
}

const converters = new IntoChaiteConverterEntry()

/**
 * @param {string} _clientType
 * @param {Function} converter
 */
export function registerIntoChaiteConverter(_clientType, converter) {
    switch (_clientType) {
        case 'openai': {
            converters.openai = converter
            break
        }
        case 'gemini': {
            converters.gemini = converter
            break
        }
        case 'claude': {
            converters.claude = converter
        }
    }
}

/**
 * @param {string} _clientType
 * @returns {Function}
 */
export function getIntoChaiteConverter(_clientType) {
    switch (_clientType) {
        case 'openai': {
            return converters.openai
        }
        case 'gemini': {
            return converters.gemini
        }
        case 'claude': {
            return converters.claude
        }
    }
}

class FromChaiteConverterEntry {
    openai
    gemini
    claude
}

const fromConverters = new FromChaiteConverterEntry()

/**
 * @param {string} _clientType
 * @param {Function} converter
 */
export function registerFromChaiteConverter(_clientType, converter) {
    switch (_clientType) {
        case 'openai': {
            fromConverters.openai = converter
            break
        }
        case 'gemini': {
            fromConverters.gemini = converter
            break
        }
        case 'claude': {
            fromConverters.claude = converter
        }
    }
}

/**
 * @param {string} _clientType
 * @returns {Function}
 */
export function getFromChaiteConverter(_clientType) {
    switch (_clientType) {
        case 'openai': {
            return fromConverters.openai
        }
        case 'gemini': {
            return fromConverters.gemini
        }
        case 'claude': {
            return fromConverters.claude
        }
    }
}

class FromChaiteToolConverterEntry {
    openai
    gemini
    claude
}

const fromToolConverters = new FromChaiteToolConverterEntry()

/**
 * @param {string} _clientType
 * @param {Function} converter
 */
export function registerFromChaiteToolConverter(_clientType, converter) {
    switch (_clientType) {
        case 'openai': {
            fromToolConverters.openai = converter
            break
        }
        case 'gemini': {
            fromToolConverters.gemini = converter
            break
        }
        case 'claude': {
            fromToolConverters.claude = converter
        }
    }
}

/**
 * @param {string} _clientType
 * @returns {Function}
 */
export function getFromChaiteToolConverter(_clientType) {
    switch (_clientType) {
        case 'openai': {
            return fromToolConverters.openai
        }
        case 'gemini': {
            return fromToolConverters.gemini
        }
        case 'claude': {
            return fromToolConverters.claude
        }
    }
}
