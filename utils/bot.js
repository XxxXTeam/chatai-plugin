/**
 * 获取机器人框架
 * @returns {'trss'|'miao'}
 */
export function getBotFramework () {
  if (Bot.bots) {
    return 'trss'
  }
  return 'miao'
}
