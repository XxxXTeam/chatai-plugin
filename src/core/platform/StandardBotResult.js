/**
 * @fileoverview 标准 Bot 调用结果与错误语义。
 * @module core/platform/StandardBotResult
 */

/**
 * 从协议端发送结果中提取消息 ID。
 * @param {*} result - 发送结果
 * @returns {string|number|null} 消息 ID
 */
export function extractStandardMessageId(result) {
    if (Array.isArray(result)) {
        for (let index = result.length - 1; index >= 0; index--) {
            const messageId = extractStandardMessageId(result[index])
            if (messageId !== null && messageId !== undefined) return messageId
        }
        return null
    }
    const value = result?.message_id ?? result?.data?.message_id ?? result?.id ?? null
    if (Array.isArray(value)) return value.length ? value[value.length - 1] : null
    return value
}

/**
 * 识别协议端返回的明确业务错误。
 * @param {*} result - 协议端结果
 * @returns {string|null} 错误信息
 */
export function getStandardResultError(result) {
    if (result === false) return '协议端返回失败'
    if (Array.isArray(result)) {
        if (result.length === 0) return null
        const failures = result
            .map((item, index) => ({ index, error: getStandardResultError(item) }))
            .filter(item => item.error)
        if (failures.length) {
            return failures.map(item => `第${item.index + 1}项: ${item.error}`).join('; ')
        }
        return null
    }
    if (!result || typeof result !== 'object') return null
    if (result.isError === true || result.success === false) {
        return result.error?.message || result.error || result.message || '协议端返回失败'
    }
    if (typeof result.retcode === 'number' && result.retcode !== 0) {
        const reason = result.message || result.wording
        return reason ? `retcode=${result.retcode} (${reason})` : `协议端返回 retcode=${result.retcode}`
    }
    if (result.status === 'failed') return result.message || result.msg || '协议端返回 status=failed'
    if (typeof result.err_code === 'number' && result.err_code !== 0) {
        return result.message || `协议端返回 err_code=${result.err_code}`
    }
    if (typeof result.code === 'number' && result.code !== 0) {
        return result.message || `协议端返回 code=${result.code}`
    }
    if (typeof result.ec === 'number' && result.ec !== 0) {
        return result.em || result.message || `协议端返回 ec=${result.ec}`
    }
    if (Array.isArray(result.error) && result.error.length) {
        return result.error.map(item => item?.message || String(item)).join('; ')
    }
    if (
        Array.isArray(result.message_id) &&
        Array.isArray(result.data) &&
        Array.isArray(result.error) &&
        result.message_id.length === 0 &&
        result.data.length === 0
    ) {
        return '协议端未返回任何成功发送结果'
    }
    return null
}

/**
 * 协议端不支持标准能力时抛出的错误。
 */
export class UnsupportedBotApiError extends Error {
    /**
     * @param {string} capability - 能力名
     * @param {string} [detail] - 补充说明
     */
    constructor(capability, detail = '') {
        super(`当前协议端不支持 ${capability}${detail ? `: ${detail}` : ''}`)
        this.name = 'UnsupportedBotApiError'
        this.code = 'UNSUPPORTED_BOT_API'
        this.capability = capability
    }
}
