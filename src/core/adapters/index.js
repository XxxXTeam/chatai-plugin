export { 
    AbstractClient,
    parseXmlToolCalls,
    preprocessMediaToBase64,
    preprocessImageUrls,
    needsBase64Preprocess,
    needsImageBase64Preprocess
} from './AbstractClient.js'

// OpenAI adapter
export { OpenAIClient } from './openai/OpenAIClient.js'
import './openai/converter.js'  

// Gemini adapter
export { GeminiClient } from './gemini/GeminiClient.js'
import './gemini/converter.js' 

// Claude adapter  
export { ClaudeClient } from './claude/ClaudeClient.js'
import './claude/converter.js'  

// Converter utilities
export {
    registerFromChaiteConverter,
    registerFromChaiteToolConverter,
    registerIntoChaiteConverter,
    getFromChaiteConverter,
    getFromChaiteToolConverter,
    getIntoChaiteConverter
} from '../utils/converter.js'

export * from '../types/index.js'
