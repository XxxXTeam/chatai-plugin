/**
 * @fileoverview 明确标记为协议专属的原始包调用边界。
 * @module core/platform/StandardRawApi
 */

import { StandardBotApi } from './StandardBotApi.js'
import { UnsupportedBotApiError } from './StandardBotResult.js'

/** 原始协议包接口。 */
export class StandardRawApi {
    /** @param {StandardBotApi} api - 标准 Bot API */
    constructor(api) {
        this.api = api
    }

    /** @param {Object} ctx - 工具上下文 */
    static fromContext(ctx) {
        return new StandardRawApi(StandardBotApi.fromContext(ctx))
    }

    /** @returns {Object} 精确低层能力矩阵 */
    capabilities() {
        const bot = this.api.bot
        return {
            sendOidbSvcTrpcTcp: typeof bot?.sendOidbSvcTrpcTcp === 'function',
            sendOidb: typeof bot?.sendOidb === 'function',
            sendUni: typeof bot?.sendUni === 'function',
            writeUni: typeof bot?.writeUni === 'function',
            sendPacket: typeof bot?.sendPacket === 'function',
            sendMergeUni: typeof bot?.sendMergeUni === 'function',
            sendApi: typeof bot?.sendApi === 'function'
        }
    }

    /**
     * 发送原始协议包。
     * @param {Object} options - 已完成编码的调用参数
     * @returns {Promise<{method: string, response: *}>} 调用结果
     */
    async send(options) {
        const bot = this.api.bot
        if (!bot) throw new UnsupportedBotApiError('raw_packet', 'Bot 实例不可用')
        const method = options.method || (Array.isArray(options.packets) ? 'send_merge_uni' : 'auto')
        const cmd = options.cmd
        const timeout = Number(options.timeout ?? 6)
        const extra = options.extra
        const body = options.body
        const isOidbCommand = typeof cmd === 'string' && /^(OidbSvc|oidb_)/i.test(cmd)
        const isTrpcOidbCommand = typeof cmd === 'string' && /^OidbSvcTrpcTcp\./i.test(cmd)

        if (
            (method === 'auto' || method === 'send_oidb_svc_trpc_tcp') &&
            typeof bot.sendOidbSvcTrpcTcp === 'function' &&
            (isTrpcOidbCommand || method === 'send_oidb_svc_trpc_tcp')
        ) {
            return { method: 'sendOidbSvcTrpcTcp', response: await bot.sendOidbSvcTrpcTcp(cmd, body, extra) }
        }
        if (
            (method === 'auto' || method === 'send_oidb') &&
            typeof bot.sendOidb === 'function' &&
            (isOidbCommand || method === 'send_oidb')
        ) {
            return { method: 'sendOidb', response: await bot.sendOidb(cmd, body, timeout, extra) }
        }
        if ((method === 'auto' || method === 'send_uni') && typeof bot.sendUni === 'function' && cmd) {
            return { method: 'sendUni', response: await bot.sendUni(cmd, body, timeout, extra) }
        }
        if ((method === 'write_uni' || method === 'write') && typeof bot.writeUni === 'function' && cmd) {
            await bot.writeUni(cmd, body, options.seq === undefined ? -1 : Number(options.seq), extra)
            return { method: 'writeUni', response: null, note: '已发送，不等待响应' }
        }
        if (method === 'send_packet' && typeof bot.sendPacket === 'function') {
            return {
                method: 'sendPacket',
                response: await bot.sendPacket(
                    body,
                    timeout,
                    options.seq === undefined ? -1 : Number(options.seq),
                    options.build || {}
                )
            }
        }
        if ((method === 'send_merge_uni' || method === 'merge') && typeof bot.sendMergeUni === 'function') {
            return { method: 'sendMergeUni', response: await bot.sendMergeUni(options.packets || [], timeout, extra) }
        }
        if (method === 'send_api' || method === 'onebot') {
            this.api.requireCapability('onebot_action')
            const action = options.action || 'send_pb_msg'
            return {
                method: 'sendApi',
                response: await this.api.callAction(action, options.params || {}, { strict: true })
            }
        }
        throw new UnsupportedBotApiError('raw_packet', `方法 ${method}`)
    }
}
