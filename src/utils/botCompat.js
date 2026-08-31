/**
 * @fileoverview 旧 Bot 兼容导出的薄代理。
 * @deprecated 新代码请直接使用 core/platform/StandardBotApi.js。
 */
export {
    getStandardBotInstance as getCompatBot,
    isQQBotInstance as isQQBot,
    preserveTargetId as normalizeBotTargetId,
    isCurrentStandardTarget as isCurrentEventTarget,
    extractStandardMessageId as extractMessageId
} from '../core/platform/index.js'
