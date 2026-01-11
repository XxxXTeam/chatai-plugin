export {
    AbstractClient,
    parseXmlToolCalls,
    preprocessMediaToBase64,
    preprocessImageUrls,
    needsBase64Preprocess,
    needsImageBase64Preprocess
} from './AbstractClient.js'
export { OpenAIClient } from './openai/OpenAIClient.js'
import './openai/converter.js'
export { GeminiClient } from './gemini/GeminiClient.js'
import './gemini/converter.js'
export { ClaudeClient } from './claude/ClaudeClient.js'
import './claude/converter.js'
export {
    registerFromChaiteConverter,
    registerFromChaiteToolConverter,
    registerIntoChaiteConverter,
    getFromChaiteConverter,
    getFromChaiteToolConverter,
    getIntoChaiteConverter
} from '../utils/converter.js'
export * from '../types/index.js'
