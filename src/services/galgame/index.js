/**
 * Galgame 服务模块导出
 */

// 服务单例
export { galgameService } from './GalgameService.js'

// 游戏渲染器
export { gameRenderer } from './GameRenderer.js'

// 常量
export {
    OPTION_EMOJIS,
    AFFECTION_LEVELS,
    TRUST_LEVELS,
    CHOICE_EMOJIS,
    DEFAULT_SYSTEM_PROMPT,
    ENVIRONMENT_PROMPT,
    INIT_PROMPT,
    MESSAGE_CACHE_TTL,
    EVENT_TYPES,
    DAILY_EVENTS,
    EXPLORE_EVENTS,
    GOLD_CONFIG,
    ITEM_TYPES,
    ITEM_TYPE_LABELS,
    ITEM_TYPE_ICONS,
    DEFAULT_ITEMS
} from './constants.js'

// 响应解析器
export {
    parseResponse,
    parseInitResponse,
    extractTextFromContent,
    processEventChoice,
    processEventWithCustomInput,
    generateRandomRewards
} from './ResponseParser.js'

// 提示词构建器
export {
    getAffectionLevel,
    getRelationshipStatus,
    getTrustLevel,
    getTrustStatus,
    buildSystemPrompt,
    buildKnownInfo,
    buildStoryProgress,
    buildOpeningPrompt
} from './PromptBuilder.js'
