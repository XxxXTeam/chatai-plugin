/**
 * 机器人框架工具函数
 * 从 utils/bot.js 迁移
 */

/**
 * 获取机器人框架
 * @returns {'trss'|'miao'}
 */
export function getBotFramework() {
    if (Bot.bots) {
        return 'trss'
    }
    return 'miao'
}
