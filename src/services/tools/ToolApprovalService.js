import crypto from 'node:crypto'
import config from '../../../config/config.js'
import { chatLogger as logger } from '../../core/utils/logger.js'
import { getToolDefinitionName, getToolIdentity } from '../../core/adapters/tooling.js'
import { toolFilterService } from './ToolFilterService.js'
import { resolveToolPermission } from './ToolPermission.js'
import { StandardBotApi } from '../../core/platform/index.js'

const RISK_ORDER = { low: 0, medium: 1, high: 2 }
const VALID_MODES = ['ask', 'auto', 'confirm_all', 'yolo']
const SENSITIVE_KEY_RE = /(api[-_]?key|token|password|secret|authorization|cookie|key)/i

/** 会话放行的有效期：超过后需重新审批，避免「允许本对话」变成永久授权 */
const SESSION_BYPASS_TTL_MS = 2 * 60 * 60 * 1000

/** 会话放行表的容量上限，key 随用户×群×会话×工具组合增长，需封顶 */
const MAX_SESSION_BYPASS_ENTRIES = 2000

const DEFAULT_LOW_RISK_TOOLS = new Set([
    'get_time',
    'get_date',
    'get_system_info',
    'calculate',
    'calculator',
    'web_search',
    'search_web',
    'search',
    'get_bot_info',
    'get_group_info',
    'get_member_info',
    'get_user_info',
    'get_weather'
])

const DEFAULT_MEDIUM_RISK_TOOLS = new Set([
    'send_message',
    'send_group_message',
    'send_private_message',
    'reply_current_message',
    'send_forward_message',
    'poke_user',
    'at_user',
    'save_memory',
    'write_context',
    'read_file',
    'list_directory',
    'fetch_url',
    'read_webpage',
    'download_file',
    'generate_image',
    'send_image',
    'send_ai_voice'
])

const DEFAULT_HIGH_RISK_TOOLS = new Set([
    'kick_member',
    'mute_member',
    'recall_message',
    'mute_all',
    'set_group_admin',
    'set_group_card',
    'set_group_title',
    'set_group_name',
    'send_group_notice',
    'delete_group_notice',
    'write_file',
    'delete_file',
    'move_file',
    'copy_file',
    'create_directory',
    'execute_command'
])

function getUniqueToolByName(tools, name) {
    if (!name || !Array.isArray(tools)) return null
    const matches = tools.filter(tool => getToolDefinitionName(tool) === name)
    return matches.length === 1 ? matches[0] : null
}

function getToolByIdentityOrUniqueName(tools, identity, name) {
    if (!Array.isArray(tools)) return null
    if (identity) {
        const identityMatch = tools.find(tool => getToolIdentity(tool) === identity)
        if (identityMatch) return identityMatch
    }
    return getUniqueToolByName(tools, name)
}

class ToolApprovalService {
    constructor() {
        this.pendingApprovals = new Map()
        this.sessionBypass = new Map()
    }

    getConfig() {
        const builtinTools = config.get('builtinTools') || {}
        return {
            approvalMode: this.normalizeMode(builtinTools.approvalMode),
            approvalTimeoutMs: Number(builtinTools.approvalTimeoutMs) || 60000,
            approvalLowRiskTools: builtinTools.approvalLowRiskTools || [],
            approvalMediumRiskTools: builtinTools.approvalMediumRiskTools || [],
            approvalHighRiskTools: builtinTools.approvalHighRiskTools || [],
            approvalBypassTools: builtinTools.approvalBypassTools || [],
            approvalAllowSessionBypass: builtinTools.approvalAllowSessionBypass !== false,
            approvalSessionBypassMaxRisk: this.normalizeRisk(builtinTools.approvalSessionBypassMaxRisk || 'medium')
        }
    }

    normalizeMode(mode) {
        return VALID_MODES.includes(mode) ? mode : 'auto'
    }

    normalizeRisk(risk) {
        return ['low', 'medium', 'high'].includes(risk) ? risk : 'medium'
    }

    listMatches(list, ...values) {
        if (!Array.isArray(list) || list.length === 0) return false
        return values.filter(Boolean).some(value => list.includes(value))
    }

    normalizeToolCall(toolCall) {
        const name = toolCall.function?.name || toolCall.name || 'unknown_tool'
        let args = toolCall.function?.arguments ?? toolCall.arguments ?? {}
        let argsParseError = null
        if (typeof args === 'string') {
            try {
                args = JSON.parse(args)
            } catch (error) {
                argsParseError = `arguments 不是合法 JSON: ${error.message}`
                args = { _raw: toolCall.function?.arguments ?? toolCall.arguments }
            }
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
            argsParseError = argsParseError || 'arguments 必须是 JSON 对象'
            args = { _raw: args }
        }
        return { id: toolCall.id || crypto.randomUUID(), name, args, argsParseError, raw: toolCall }
    }

    classifyRisk(toolName, tool = null) {
        const cfg = this.getConfig()
        const identity = getToolIdentity(tool) || ''
        if (this.listMatches(cfg.approvalHighRiskTools, toolName, identity)) return 'high'
        if (this.listMatches(cfg.approvalMediumRiskTools, toolName, identity)) return 'medium'
        if (this.listMatches(cfg.approvalLowRiskTools, toolName, identity)) return 'low'

        const dangerousTools = config.get('builtinTools.dangerousTools') || []
        if (
            tool?.dangerous ||
            tool?.function?.dangerous ||
            this.listMatches(dangerousTools, toolName, identity) ||
            DEFAULT_HIGH_RISK_TOOLS.has(toolName)
        ) {
            return 'high'
        }
        if (
            DEFAULT_MEDIUM_RISK_TOOLS.has(toolName) ||
            /(^send_|_message$|file|url|webpage|download|memory|context|image|voice|media)/i.test(toolName)
        ) {
            return 'medium'
        }
        if (
            DEFAULT_LOW_RISK_TOOLS.has(toolName) ||
            /^(get|list|search|query|read_context|calculate|calc)_?/i.test(toolName)
        ) {
            return 'low'
        }
        return 'medium'
    }

    createToolResult(toolCall, name, message, isError = true) {
        const content = JSON.stringify({
            status: isError ? 'error' : 'success',
            tool: name,
            content: message,
            metadata: { approval: true }
        })
        let args = toolCall?.function?.arguments ?? toolCall?.arguments ?? {}
        if (typeof args === 'string') {
            try {
                args = JSON.parse(args)
            } catch {
                args = { _raw: args }
            }
        }
        return {
            toolResult: {
                tool_call_id: toolCall.id || crypto.randomUUID(),
                content,
                type: 'tool',
                name,
                mcpContent: [{ type: 'text', text: message }],
                isError
            },
            log: {
                name,
                args,
                result: message,
                duration: 0,
                isError
            }
        }
    }

    getScopeKey(options = {}) {
        const conversationId = options.conversationId || 'default'
        const userId = options.userId || options.event?.user_id || 'unknown'
        const groupId = options.groupId || options.event?.group_id || 'private'
        return `${conversationId}:${groupId}:${userId}`
    }

    getBypassKey(options, toolKey) {
        return `${this.getScopeKey(options)}:${toolKey}`
    }

    canSessionBypass(risk, cfg = this.getConfig()) {
        return cfg.approvalAllowSessionBypass && RISK_ORDER[risk] <= RISK_ORDER[cfg.approvalSessionBypassMaxRisk]
    }

    isSessionBypassed(options, toolKey, risk) {
        if (!this.canSessionBypass(risk)) return false
        const key = this.getBypassKey(options, toolKey)
        const grantedAt = this.sessionBypass.get(key)
        if (grantedAt === undefined) return false
        // 授权过期即撤销，避免"允许本对话"变成永久授权
        if (Date.now() - grantedAt > SESSION_BYPASS_TTL_MS) {
            this.sessionBypass.delete(key)
            return false
        }
        return true
    }

    addSessionBypass(options, items) {
        for (const item of items) {
            if (this.canSessionBypass(item.risk)) {
                this.sessionBypass.set(this.getBypassKey(options, item.identity || item.name), Date.now())
            }
        }
        this.evictExpiredBypass()
    }

    /**
     * 清理过期的会话放行记录
     *
     * key 形如 `${conversationId}:${groupId}:${userId}:${toolKey}`，随用户×群×会话×工具
     * 四维组合增长；原实现只有 set/has、没有任何删除路径，且存入的时间戳从未被读取——
     * 说明本就设计了过期机制但未实现。这里补上按 TTL 驱逐与容量上限。
     * @returns {void}
     */
    evictExpiredBypass() {
        const now = Date.now()
        for (const [key, grantedAt] of this.sessionBypass) {
            if (now - grantedAt > SESSION_BYPASS_TTL_MS) this.sessionBypass.delete(key)
        }
        // Map 保持插入顺序，超出上限时淘汰最早写入的条目
        while (this.sessionBypass.size > MAX_SESSION_BYPASS_ENTRIES) {
            const oldest = this.sessionBypass.keys().next().value
            if (oldest === undefined) break
            this.sessionBypass.delete(oldest)
        }
    }

    redactValue(key, value, depth = 0) {
        if (SENSITIVE_KEY_RE.test(String(key))) return '***'
        if (value == null) return value
        if (typeof value === 'string') {
            return value.length > 160 ? `${value.slice(0, 160)}...` : value
        }
        if (typeof value !== 'object') return value
        if (depth >= 2) return '[Object]'
        if (Array.isArray(value)) {
            return value.slice(0, 10).map((item, index) => this.redactValue(index, item, depth + 1))
        }
        const result = {}
        for (const [childKey, childValue] of Object.entries(value).slice(0, 20)) {
            result[childKey] = this.redactValue(childKey, childValue, depth + 1)
        }
        return result
    }

    summarizeArgs(args) {
        const redacted = this.redactValue('', args)
        const text = JSON.stringify(redacted)
        return text.length > 500 ? `${text.slice(0, 500)}...` : text
    }

    buildApprovalMessage(items, cfg = this.getConfig()) {
        const lines = ['检测到模型请求执行工具：']
        items.forEach((item, index) => {
            lines.push(`[${index + 1}] ${item.name} 风险: ${item.risk}`)
            lines.push(`参数: ${item.summary}`)
        })
        lines.push('')
        lines.push(cfg.approvalAllowSessionBypass ? '回复：确认 / 取消 / 允许本对话' : '回复：确认 / 取消')
        return lines.join('\n')
    }

    async sendApprovalPrompt(options, message) {
        const event = options.event
        if (!event?.reply) {
            logger.warn('[ToolApproval] 无可用 event.reply，拒绝需要确认的工具调用')
            return false
        }
        await new StandardBotApi({ event }).reply(message, true)
        return true
    }

    createApproval(items, options, cfg) {
        const approvalId = crypto.randomBytes(4).toString('hex')
        const key = this.getScopeKey(options)
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.pendingApprovals.delete(approvalId)
                resolve({ action: 'timeout', approvalId })
            }, cfg.approvalTimeoutMs)
            this.pendingApprovals.set(approvalId, {
                approvalId,
                key,
                items,
                options,
                timer,
                resolve,
                createdAt: Date.now()
            })
        })
    }

    async preflight(toolCalls, options = {}) {
        const cfg = this.getConfig()
        const mode = this.normalizeMode(options.toolApprovalMode || cfg.approvalMode)
        const passThrough = []
        const blockedResults = []
        const needsApproval = []
        const presetId = options.presetId || 'default'
        const userPermission = resolveToolPermission(options)
        const context = {
            groupId: options.groupId || options.event?.group_id,
            userId: options.userId || options.event?.user_id
        }

        const availableTools = options.availableTools || []
        const availableToolNames = new Set(availableTools.map(getToolDefinitionName).filter(Boolean))
        const availableToolIdentities = new Set(availableTools.map(getToolIdentity).filter(Boolean))

        for (const toolCall of toolCalls || []) {
            const normalized = this.normalizeToolCall(toolCall)
            const normalizedIdentity = getToolIdentity(toolCall) || normalized.name
            if (normalized.argsParseError) {
                blockedResults.push(
                    this.createToolResult(toolCall, normalized.name, `工具未执行：${normalized.argsParseError}`)
                )
                continue
            }
            if (
                normalized.name === 'unknown_tool' ||
                (availableToolNames.size > 0 &&
                    !availableToolNames.has(normalized.name) &&
                    !availableToolIdentities.has(normalizedIdentity))
            ) {
                const reason =
                    normalized.name === 'unknown_tool'
                        ? '工具未执行：工具名称缺失'
                        : `工具未执行：未知工具 ${normalized.name}`
                blockedResults.push(this.createToolResult(toolCall, normalized.name, reason))
                continue
            }

            const tool = getToolByIdentityOrUniqueName(availableTools, normalizedIdentity, normalized.name)
            if (!tool && availableTools.filter(t => getToolDefinitionName(t) === normalized.name).length > 1) {
                blockedResults.push(
                    this.createToolResult(toolCall, normalized.name, `工具未执行：无法唯一定位工具 ${normalized.name}`)
                )
                continue
            }
            const access = toolFilterService.checkToolAccess(normalized.name, presetId, {
                userPermission,
                groupId: context.groupId,
                userId: context.userId,
                tool
            })
            if (!access.allowed) {
                blockedResults.push(this.createToolResult(toolCall, normalized.name, `工具未执行：${access.reason}`))
                continue
            }

            const validation = toolFilterService.validateToolCall(normalized.name, normalized.args, context)
            if (!validation.valid) {
                blockedResults.push(
                    this.createToolResult(toolCall, normalized.name, `工具未执行：${validation.reason}`)
                )
                continue
            }

            const risk = this.classifyRisk(normalized.name, tool)
            normalized.identity = getToolIdentity(tool) || normalizedIdentity
            normalized.risk = risk
            normalized.summary = this.summarizeArgs(normalized.args)

            if (mode === 'ask') {
                blockedResults.push(this.createToolResult(toolCall, normalized.name, 'ask 模式不执行工具'))
                continue
            }
            if (mode === 'yolo' || this.listMatches(cfg.approvalBypassTools, normalized.name, normalized.identity)) {
                passThrough.push(toolCall)
                continue
            }
            if (this.isSessionBypassed(options, normalized.identity || normalized.name, risk)) {
                passThrough.push(toolCall)
                continue
            }
            if (mode === 'auto' && risk === 'low') {
                passThrough.push(toolCall)
                continue
            }

            needsApproval.push(normalized)
        }

        if (needsApproval.length === 0) {
            return { approvedToolCalls: passThrough, blockedResults }
        }

        const message = this.buildApprovalMessage(needsApproval, cfg)
        const sent = await this.sendApprovalPrompt(options, message)
        if (!sent) {
            for (const item of needsApproval) {
                blockedResults.push(this.createToolResult(item.raw, item.name, '工具未执行：当前环境无法发送确认请求'))
            }
            return { approvedToolCalls: passThrough, blockedResults }
        }

        const result = await this.createApproval(needsApproval, options, cfg)
        if (result.action === 'confirm' || result.action === 'allow_session') {
            if (result.action === 'allow_session') this.addSessionBypass(options, needsApproval)
            passThrough.push(...needsApproval.map(item => item.raw))
        } else {
            const reason = result.action === 'timeout' ? '确认超时' : '用户取消'
            for (const item of needsApproval) {
                blockedResults.push(this.createToolResult(item.raw, item.name, `工具未执行：${reason}`))
            }
        }

        return { approvedToolCalls: passThrough, blockedResults }
    }

    resolveApproval(input, options = {}) {
        const text = String(input || '').trim()
        if (!text) return { matched: false }

        let action = null
        let explicitId = null
        const idMatch = text.match(/(?:确认工具|取消工具)\s*([a-f0-9]{8})/i)
        if (/^(确认|确认工具)/.test(text)) action = 'confirm'
        if (/^(取消|取消工具|拒绝)/.test(text)) action = 'cancel'
        if (/^(允许本对话|总是允许本对话)/.test(text)) action = 'allow_session'
        if (idMatch) explicitId = idMatch[1]
        if (!action) return { matched: false }

        const key = this.getScopeKey(options)
        const candidates = [...this.pendingApprovals.values()].filter(item => item.key === key)
        const approval = explicitId
            ? candidates.find(item => item.approvalId === explicitId)
            : candidates.sort((a, b) => b.createdAt - a.createdAt)[0]

        if (!approval) return { matched: false }

        clearTimeout(approval.timer)
        this.pendingApprovals.delete(approval.approvalId)
        approval.resolve({ action, approvalId: approval.approvalId })
        return { matched: true, handled: true, action, approvalId: approval.approvalId }
    }
}

export const toolApprovalService = new ToolApprovalService()
export default toolApprovalService
