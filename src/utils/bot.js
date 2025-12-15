/**
 * 机器人框架工具函数
 * @deprecated 此模块已合并到 platformAdapter.js，请从那里导入
 * @module utils/bot
 */

// 从 platformAdapter.js 重新导出所有函数
export {
    // 平台检测
    detectFramework,
    detectAdapter,
    detectPlatform,
    getBotInfo,
    // Bot 实例管理
    getBot,
    getBotSelfId,
    getAllBots,
    isBotOnline,
    getBotNickname,
    // 权限检查
    isMaster,
    isAdmin,
    // 消息辅助
    getSenderName,
    isGroupMessage,
    isPrivateMessage,
    safeReply,
    // 兼容旧版API名称
    getBotFramework,
    getAdapter,
    getFrameworkInfo
} from './platformAdapter.js'

// 消息段构建器（从 messageParser.js 的 segment 使用）
import { segment } from './messageParser.js'

/**
 * 格式化 @ 消息段
 * @deprecated 使用 segment.at() 代替
 */
export const at = (userId) => segment.at(userId)

/**
 * 格式化图片消息段
 * @deprecated 使用 segment.image() 代替
 */
export const image = (file) => segment.image(file)

/**
 * 格式化文本消息段
 * @deprecated 使用 segment.text() 代替
 */
export const text = (t) => segment.text(t)

/**
 * 格式化语音消息段
 * @deprecated 使用 segment.record() 代替
 */
export const record = (file) => segment.record(file)
