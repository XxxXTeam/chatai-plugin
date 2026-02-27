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

/*
 * 通用转换器注册器工厂
 * 用于按 clientType（openai/gemini/claude）注册和获取转换函数
 * @returns {{ register: Function, get: Function }}
 */
function createConverterRegistry() {
    const store = Object.create(null)
    return {
        register(clientType, converter) {
            store[clientType] = converter
        },
        get(clientType) {
            return store[clientType]
        }
    }
}

/* 三类转换器注册表：IntoChaite / FromChaite / FromChaiteTool */
const intoChaite = createConverterRegistry()
const fromChaite = createConverterRegistry()
const fromChaiteTool = createConverterRegistry()

/* 对外接口保持不变 */
export const registerIntoChaiteConverter = intoChaite.register
export const getIntoChaiteConverter = intoChaite.get
export const registerFromChaiteConverter = fromChaite.register
export const getFromChaiteConverter = fromChaite.get
export const registerFromChaiteToolConverter = fromChaiteTool.register
export const getFromChaiteToolConverter = fromChaiteTool.get
