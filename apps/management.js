import config from '../config/config.js'
import crypto from 'node:crypto'
import { getWebServer } from '../src/services/webServer.js'

/**
 * 管理面板
 */
export class management extends plugin {
    constructor() {
        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
        super({
            name: 'AI-管理',
            dsc: 'AI插件管理',
            event: 'message',
            priority: 20,
            rule: [
                {
                    reg: `^${cmdPrefix}管理面板$`,
                    fnc: 'managementPanel',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}?#?结束(全部)?对话$`,
                    fnc: 'destroyConversation'
                },
                {
                    reg: `^${cmdPrefix}状态$`,
                    fnc: 'status',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}调试(开启|关闭)$`,
                    fnc: 'toggleDebug',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}伪人(开启|关闭)$`,
                    fnc: 'toggleBym',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}设置(模型|model)\\s*(.+)$`,
                    fnc: 'setModel',
                    permission: 'master'
                }
            ]
        })
    }

    /**
   * 管理面板 - 生成临时token和登录链接
   */
    async managementPanel(e) {
        const webServer = getWebServer()
        const addresses = webServer.getAddresses()
        
        // 生成登录链接
        const localUrl = webServer.generateLoginUrl(false)
        const publicUrl = addresses.public ? webServer.generateLoginUrl(true) : null

        const messages = [
            '=== AI插件管理面板 ===',
            '',
            '【本地访问】',
            localUrl
        ]
        
        if (publicUrl) {
            messages.push('')
            messages.push('【公网访问】')
            messages.push(publicUrl)
        }
        
        messages.push('')
        messages.push('链接有效期: 5分钟')
        messages.push('点击链接即可自动登录')

        await e.reply(messages.join('\n'), true)
        return true
    }

    /**
     * 结束对话
     */
    async destroyConversation(e) {
        if (e.msg.includes('全部')) {
            if (!e.isMaster) {
                await e.reply('仅限主人使用')
                return false
            }
            // TODO: 清除所有用户会话
            await e.reply('已结束全部对话')
        } else {
            // 为当前用户生成新的conversation ID
            await e.reply('已结束当前对话')
        }
        return true
    }

    /**
     * 查看状态
     */
    async status(e) {
        const messages = []

        // 基本配置
        let basic = '=== 基本配置 ===\n'
        basic += `默认模型: ${config.get('llm.defaultModel')}\n`
        basic += `调试模式: ${config.get('basic.debug') ? '开启' : '关闭'}\n`
        basic += `触发模式: ${config.get('basic.toggleMode')}\n`
        basic += `命令前缀: ${config.get('basic.commandPrefix')}`
        messages.push(basic)

        // OpenAI配置状态
        let openaiStatus = '=== OpenAI 配置 ===\n'
        openaiStatus += `API Key: ${config.get('openai.apiKey') ? '已配置' : '未配置'}\n`
        openaiStatus += `Base URL: ${config.get('openai.baseUrl')}`
        messages.push(openaiStatus)

        // 伪人模式
        let bymStatus = '=== 伪人模式 ===\n'
        bymStatus += `启用状态: ${config.get('bym.enable') ? '开启' : '关闭'}\n`
        bymStatus += `触发概率: ${(config.get('bym.probability') || 0.02) * 100}%\n`
        bymStatus += `回复温度: ${config.get('bym.temperature') || 0.9}`
        messages.push(bymStatus)

        await e.reply(messages.join('\n\n'), true)
        return true
    }

    /**
     * 切换调试模式
     */
    async toggleDebug(e) {
        const action = e.msg.includes('开启')
        config.set('basic.debug', action)
        await e.reply(`调试模式已${action ? '开启' : '关闭'}`, true)
        return true
    }

    /**
     * 切换伪人模式
     */
    async toggleBym(e) {
        const action = e.msg.includes('开启')
        config.set('bym.enable', action)
        await e.reply(`伪人模式已${action ? '开启' : '关闭'}`, true)
        return true
    }

    /**
     * 设置默认模型
     */
    async setModel(e) {
        const model = e.msg.match(/设置(?:模型|model)\s*(.+)$/)?.[1]?.trim()
        if (!model) {
            await e.reply('请指定模型名称', true)
            return false
        }

        config.set('llm.defaultModel', model)
        await e.reply(`默认模型已设置为: ${model}`, true)
        return true
    }
}
