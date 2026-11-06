/**
 * @fileoverview 引用回复开关的会话类型解析
 * @module utils/replySettings
 * @description 将全局引用回复配置按群聊/私聊拆分，同时兼容旧的 basic.quoteReply。
 */

import config from '../../config/config.js'

/**
 * 判断事件是否来自群聊。
 * @param {Object} e - Yunzai 事件对象
 * @returns {boolean}
 */
export function isGroupChatEvent(e) {
    return Boolean(e?.isGroup || e?.group_id || e?.data?.group_id)
}

/**
 * 解析当前会话应使用的引用回复开关。
 *
 * 新配置 `basic.quoteReplyGroup` / `basic.quoteReplyPrivate` 优先；
 * 对应键缺失或不是布尔值时回退到旧的 `basic.quoteReply`，保证旧配置行为不变。
 *
 * @param {Object} e - Yunzai 事件对象
 * @param {Object} [basicConfig] - 可注入的 basic 配置（测试用）
 * @returns {boolean}
 */
export function resolveQuoteReply(e, basicConfig = config.get('basic') || {}) {
    const basic = basicConfig || {}
    const legacyValue = basic.quoteReply !== false
    const key = isGroupChatEvent(e) ? 'quoteReplyGroup' : 'quoteReplyPrivate'
    const value = basic[key]
    return typeof value === 'boolean' ? value : legacyValue
}
