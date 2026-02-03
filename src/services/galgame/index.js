/**
 * Galgame 服务模块导出
 */

// 服务单例
export { galgameService } from './GalgameService.js'

// 常量
export {
    OPTION_EMOJIS,
    AFFECTION_LEVELS,
    CHOICE_EMOJIS,
    DEFAULT_SYSTEM_PROMPT,
    ENVIRONMENT_PROMPT,
    INIT_PROMPT,
    MESSAGE_CACHE_TTL
} from './constants.js'

// 响应解析器
export {
    parseResponse,
    parseInitResponse,
    extractTextFromContent,
    processEventChoice,
    processEventWithCustomInput
} from './ResponseParser.js'

// 提示词构建器
export {
    getAffectionLevel,
    getRelationshipStatus,
    buildSystemPrompt,
    buildKnownInfo,
    buildStoryProgress,
    buildOpeningPrompt
} from './PromptBuilder.js'
