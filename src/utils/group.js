/**
 * 群组工具函数
 */
import { StandardBotApi } from '../core/platform/index.js'
import config from '../../config/config.js'
import { formatTimeToBeiJing } from './common.js'
import { cleanCQCode } from './messageParser.js'
import { getRecentQQBotMessages } from '../services/storage/MessageCache.js'

/**
 * 规范化群历史读取数量，避免兼容调用传入无界或非整数值。
 * @param {*} value - 原始数量
 * @returns {number} 1 到 200 的整数
 */
function normalizeHistoryLength(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 20
    return Math.min(200, Math.max(1, Math.trunc(parsed)))
}

export class GroupContextCollector {
    /**
     * 获取群组上下文
     * @param {*} bot bot实例
     * @param {string} groupId 群号
     * @param {string|number} start 起始 seq 或 QQBot message_id
     * @param {number} length 往前数几条
     * @returns {Promise<Array<*>>}
     */
    async collect(bot = globalThis.Bot, groupId, start = 0, length = 20) {
        if (!bot || groupId === undefined || groupId === null || groupId === '') return []
        const api = new StandardBotApi({ bot })
        if (api.isQQBot) {
            return await api.getHistory({
                groupId,
                count: normalizeHistoryLength(length)
            })
        }
        return await api.getHistory({
            groupId,
            sequence: start,
            count: normalizeHistoryLength(length)
        })
    }
}

/** @deprecated 仅保留旧导入名称，群历史实现已统一到 GroupContextCollector。 */
export class ICQQGroupContextCollector extends GroupContextCollector {}

/** @deprecated 仅保留旧导入名称，群历史实现已统一到 GroupContextCollector。 */
export class TRSSGroupContextCollector extends GroupContextCollector {}

/**
 * 获取群组上下文
 * @param e
 * @param length
 * @returns {Promise<Array<*>>}
 */
export async function getGroupHistory(e, length = 20) {
    if (!e) return []
    const api = new StandardBotApi({ event: e, bot: e.bot || globalThis.Bot })
    const groupId = e.group_id || e.group?.group_id
    if (groupId === undefined || groupId === null || groupId === '') return []
    if (api.isQQBot) {
        return getRecentQQBotMessages(groupId, normalizeHistoryLength(length), e._raw_group_id).map(message => ({
            message_id: message.message_id,
            time: message.message_time,
            sender: message.sender || {
                user_id: message.userId,
                nickname: message.nickname
            },
            message: message.message || [],
            raw_message: message.content,
            group_id: message.group_id,
            _raw_group_id: message._raw_group_id
        }))
    }
    return await api.getHistory({ groupId, sequence: undefined, count: normalizeHistoryLength(length) })
}

/**
 * 获取构建群聊聊天记录的prompt
 * @param e event
 * @param {number} length 长度
 * @returns {Promise<string>}
 */
export async function getGroupContextPrompt(e, length) {
    const {
        groupContextTemplatePrefix = '',
        groupContextTemplateMessage = '',
        groupContextTemplateSuffix = ''
    } = config.llm || {}
    const chats = await getGroupHistory(e, length)
    const rows = chats
        .filter(chat => chat)
        .map(chat => {
            const sender = chat.sender || {}
            return (
                groupContextTemplateMessage
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.sender.card}', sender.card || '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.sender.nickname}', sender.nickname || '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.sender.user_id}', sender.user_id || '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.sender.role}', sender.role || '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.sender.title}', sender.title || '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.time}', chat.time ? formatTimeToBeiJing(chat.time) : '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.messageId}', chat.messageId || '-')
                    // eslint-disable-next-line no-template-curly-in-string
                    .replace('${message.raw_message}', cleanCQCode(chat.raw_message || '') || '-')
            )
        })
        .join('\n')
    return [
        groupContextTemplatePrefix
            // eslint-disable-next-line no-template-curly-in-string
            .replace('${group.group_id}', e.group?.group_id || e.group_id || 'unknown')
            // eslint-disable-next-line no-template-curly-in-string
            .replace('${group.name}', e.group?.name || e.group_name || 'unknown'),
        rows,
        groupContextTemplateSuffix
    ].join('\n')
}
