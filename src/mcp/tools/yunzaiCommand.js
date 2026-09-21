/**
 * @fileoverview yunzai_command 内置模块化工具（yunzai 插件命令搜索与执行）。
 * @module mcp/tools/yunzaiCommand
 * @description
 */

import { randomBytes } from 'node:crypto'
import { chatLogger as logger } from '../../core/utils/logger.js'
import { StandardBotApi } from '../../core/platform/index.js'

const CANDIDATE_TTL = 2 * 60 * 1000
const REPEAT_WINDOW = 10 * 1000
const EXECUTION_TIMEOUT = 30 * 1000
const MAX_RESULTS = 15
const MAX_CANDIDATES = 500
const MAX_QUERY_LENGTH = 40
const MAX_COMMAND_LENGTH = 160

/** 搜索引擎对命名空间状态的绑定（跨模块热重载实例共享） */
const YUNZAI_COMMAND_NAMESPACE = Symbol.for('chatgpt-yunzai-command-state-v1')

/**
 * 全局缓存的原插件加载器引用。
 * 模块热重载后的新实例优先从这里恢复，避免状态分割。
 * @type {{loader: Object|null}}
 */
const GLOBAL_COMMAND_LOADER = (globalThis[YUNZAI_COMMAND_NAMESPACE] ||= { loader: null })

/**
 * 工具模块自身引用的加载器（可能是全局缓存，也可能是导入的模块）。
 * @type {Object|null}
 */
let commandLoaderModule = null

/**
 * 命令搜索缓存。原实现以 loader 层级保存，
 * 但跨实例仍应存活，所以统一挂全局符号。
 * @type {Map<string, {expiresAt: number, scope: string, fingerprint: Object}>}
 */
const commandCandidates = (GLOBAL_COMMAND_LOADER.candidates ||= new Map())

const inputSchema = {
    type: 'object',
    properties: {
        action: {
            type: 'string',
            enum: ['search', 'execute'],
            description: 'search=搜索可用命令；execute=执行已搜索到的候选命令'
        },
        query: {
            type: 'string',
            description: 'action=search 时必填。命令关键词或可能的完整命令，例如"帮助"或"#帮助"'
        },
        candidate_id: {
            type: 'string',
            description: 'action=execute 时必填，只能使用本工具 search 返回的短期候选 ID'
        },
        command: {
            type: 'string',
            description: 'action=execute 时必填。要作为当前用户消息执行的完整命令，必须匹配候选规则'
        },
        user_id: {
            type: 'string',
            description: '当前用户 ID，用于隔离搜索缓存；由系统自动填充，不要猜测或改写'
        },
        group_id: {
            type: 'string',
            description: '当前群 ID，用于隔离搜索缓存；由系统自动填充，私聊可省略'
        }
    },
    required: ['action'],
    additionalProperties: false
}

function valueId(value) {
    return value === undefined || value === null ? '' : String(value)
}

function getScope(event) {
    const platform = StandardBotApi.fromContext({ event })
    const botInfo = platform.getBotInfo()
    const botId = botInfo?.user_id ?? valueId(event?.self_id)
    return {
        botId: valueId(botId),
        userId: valueId(event?.user_id ?? event?.sender?.user_id),
        groupId: valueId(event?.group_id),
        messageId: valueId(event?.message_id ?? event?.source?.message_id ?? event?.seq)
    }
}

function scopeKey(scope) {
    return `${scope.botId}\u0001${scope.userId}\u0001${scope.groupId || 'private'}\u0001${scope.messageId || 'no-msg'}`
}

function validateProvidedScope(args, scope) {
    if (args.user_id !== undefined && valueId(args.user_id) !== scope.userId) {
        return 'user_id 与当前消息发送者不一致'
    }
    if (args.group_id !== undefined && valueId(args.group_id) !== scope.groupId) {
        return 'group_id 与当前会话不一致'
    }
    return ''
}

function pruneState(now = Date.now()) {
    for (const [id, record] of commandCandidates) {
        if (record.expiresAt <= now) commandCandidates.delete(id)
    }
    if (GLOBAL_COMMAND_LOADER.recentExecutions) {
        for (const [key, timestamp] of GLOBAL_COMMAND_LOADER.recentExecutions) {
            if (now - timestamp > REPEAT_WINDOW * 6) GLOBAL_COMMAND_LOADER.recentExecutions.delete(key)
        }
    }
    while (commandCandidates.size > MAX_CANDIDATES) {
        const oldest = commandCandidates.keys().next().value
        if (!oldest) break
        commandCandidates.delete(oldest)
    }
}

function createCandidateId() {
    let id
    do id = randomBytes(12).toString('base64url')
    while (commandCandidates.has(id))
    return id
}

function normalizeReg(reg) {
    try {
        if (reg instanceof RegExp) return new RegExp(reg.source, reg.flags)
        if (typeof reg === 'string' && reg.length > 0) return new RegExp(reg)
    } catch {
        /* 无效规则由 Yunzai 加载器负责报告；此工具只跳过它。 */
    }
    return null
}

function regIdentity(reg) {
    const normalized = normalizeReg(reg)
    return normalized ? `${normalized.source}\u0001${normalized.flags}` : ''
}

function regMatches(reg, text) {
    const normalized = normalizeReg(reg)
    if (!normalized) return false
    normalized.lastIndex = 0
    return normalized.test(text)
}

function regToReadable(reg) {
    const normalized = normalizeReg(reg)
    if (!normalized) return ''

    return normalized.source
        .replace(/^\^/, '')
        .replace(/\$$/, '')
        .replace(/\\s\*|\\s\+/g, ' ')
        .replace(/\[\\s\\S\]\+|\.\+/g, '<内容>')
        .replace(/\[\\s\\S\]\*|\.\*/g, '<任意>')
        .replace(/\\d\+/g, '<数字>')
        .replace(/\\w\+/g, '<字符>')
        .replace(/\\([#*+?.(){}[\]\\|^$])/g, '$1')
}

function normalizePermission(permission) {
    if (permission === undefined || permission === null || permission === '') return 'public'
    return String(permission).toLowerCase()
}

function isRecursivePlugin(item) {
    const key = String(item?.key || '').replaceAll('\\', '/')
    return key.startsWith('chatgpt-plugin/')
}

function safeError(error) {
    const message = error instanceof Error ? error.message : String(error || '未知错误')
    return message.slice(0, 300)
}

/**
 * @returns {Promise<Object|null>} Yunzai loader 实例，失败返回 null
 */
async function resolveYunzaiLoaderManager() {
    if (commandLoaderModule?.priority) return commandLoaderModule

    let loaderRef = GLOBAL_COMMAND_LOADER.loader
    if (!loaderRef || !Array.isArray(loaderRef?.priority)) {
        const candidates = []
        if (globalThis.plugin && typeof globalThis.plugin === 'object') {
            if (Array.isArray(globalThis.plugin?.priority)) candidates.push(globalThis.plugin)
            if (globalThis.plugin?.loader && typeof globalThis.plugin.loader === 'object') {
                candidates.push(globalThis.plugin.loader)
            }
            if (globalThis.plugin?.loader?.loader) candidates.push(globalThis.plugin.loader.loader)
        }

        try {
            const imported = await import('../../../../lib/plugins/loader.js')
            if (imported?.default?.priority) candidates.push(imported.default)
        } catch (importError) {
            logger.debug(`[yunzai_command] 未找到标准路径 loader: ${importError.message}`)
        }

        loaderRef = candidates.find(item => Array.isArray(item?.priority)) || null
        if (loaderRef) GLOBAL_COMMAND_LOADER.loader = loaderRef
    }

    if (!loaderRef) return null
    commandLoaderModule = loaderRef
    return loaderRef
}

/**
 * 只读判断规则是否适用于当前事件。
 * 优先使用 Yunzai loader 原生的 filtEvent；没有原生过滤时退回宽松匹配。
 * @param {Object} loaderInstance - Yunzai loader 实例
 * @param {Object} event - 当前事件
 * @param {Object} rule - 规则
 * @returns {Promise<boolean>} 是否匹配
 */
async function eventMatches(loaderInstance, event, rule) {
    if (!rule?.event) return true
    if (typeof loaderInstance?.filtEvent === 'function') {
        try {
            return loaderInstance.filtEvent(event, rule) === true
        } catch {
            return false
        }
    }
    return true
}

/**
 * 只读判断当前触发者是否具备规则要求的权限。
 * 原实现手写近似逻辑，这里统一走 Yunzai loader 的 filtPermission。
 * @param {Object} loaderInstance - Yunzai loader 实例
 * @param {Object} event - 当前事件
 * @param {Object} rule - 规则
 * @returns {Promise<boolean>} 是否具备权限
 */
async function hasRulePermission(loaderInstance, event, rule) {
    const permission = normalizePermission(rule?.permission)
    if (permission === 'public' || event?.isMaster) return true

    if (typeof loaderInstance?.filtPermission === 'function') {
        try {
            return loaderInstance.filtPermission(event, rule) === true
        } catch {
            /* 原生判断出错时按公开规则处理，交由 execute 阶段的真判兜底 */
        }
    }

    const isGroup = event?.isGroup === true || Boolean(event?.group_id)
    const isOwner = event?.member?.is_owner === true
    const isAdmin = isOwner || event?.member?.is_admin === true

    if (permission === 'master' || permission === '1') return false
    if (permission === 'owner' || permission === '2') return isGroup && isOwner
    if (permission === 'admin' || permission === '3') return isGroup && isAdmin
    return true
}

/**
 * 命令执行器的权限检查。与 search 阶段不同，
 * 这里必须调用 Yunzai 自己的真判（会触发权限拒绝回复），
 * 不再使用近似逻辑。
 * @param {Object} loaderInstance - Yunzai loader 实例
 * @param {Object} commandEvent - 命令事件
 * @param {Object} rule - 规则
 * @returns {Promise<boolean>} 是否放行
 */
async function checkExecutionPermission(loaderInstance, commandEvent, rule) {
    if (typeof loaderInstance?.filtPermission === 'function') {
        try {
            return loaderInstance.filtPermission(commandEvent, rule) === true
        } catch {
            /* 原生判断异常时拒绝执行 */
        }
    }
    return commandEvent?.isMaster === true
}

function ruleFingerprint(item, rule, ruleIndex) {
    const priority = Number(item?.priority)
    return {
        key: String(item?.key || ''),
        pluginName: String(item?.name || ''),
        priority: Number.isFinite(priority) ? priority : 99999,
        ruleIndex,
        fnc: String(rule?.fnc || ''),
        reg: regIdentity(rule?.reg)
    }
}

function sameFingerprint(item, rule, ruleIndex, fingerprint) {
    const current = ruleFingerprint(item, rule, ruleIndex)
    return (
        current.key === fingerprint.key &&
        current.pluginName === fingerprint.pluginName &&
        current.priority === fingerprint.priority &&
        current.ruleIndex === fingerprint.ruleIndex &&
        current.fnc === fingerprint.fnc &&
        current.reg === fingerprint.reg
    )
}

/**
 * 按指纹在 loader.priority 里定位当前规则。
 * @param {Object} loaderInstance - Yunzai loader 实例
 * @param {Object} fingerprint - 规则指纹
 * @returns {{item: Object, rule: Object}|null}
 */
function findCurrentRule(loaderInstance, fingerprint) {
    for (const item of loaderInstance.priority || []) {
        if (String(item?.key || '') !== fingerprint.key) continue
        if (String(item?.name || '') !== fingerprint.pluginName) continue
        const rules = item?.plugin?.rule
        if (!Array.isArray(rules)) continue
        const rule = rules[fingerprint.ruleIndex]
        if (rule && sameFingerprint(item, rule, fingerprint.ruleIndex, fingerprint)) {
            return { item, rule }
        }
    }
    return null
}

/**
 * 克隆当前事件并替换为「以命令为消息」的执行事件。
 * reply 会被替换为触发 onReply 回调后继续转发原 reply，
 * 防插件直接修改 e.reply 绕过回复计数。
 * @param {Object} event - 原始事件
 * @param {string} command - 要执行的命令文本
 * @param {Function} onReply - 插件调用 reply 时触发
 * @returns {Object} 命令执行事件
 */
function cloneEventForCommand(event, command, onReply) {
    const descriptors = Object.getOwnPropertyDescriptors(event)
    for (const key of ['msg', 'raw_message', 'original_msg', 'message', 'reply']) delete descriptors[key]

    const commandEvent = Object.create(Object.getPrototypeOf(event), descriptors)
    Object.defineProperties(commandEvent, {
        msg: { value: command, writable: true, configurable: true, enumerable: true },
        raw_message: { value: command, writable: true, configurable: true, enumerable: true },
        original_msg: { value: command, writable: true, configurable: true, enumerable: true },
        message: {
            value: [{ type: 'text', text: command }],
            writable: true,
            configurable: true,
            enumerable: true
        },
        reply: {
            value: async (...replyArgs) => {
                onReply()
                // 协议回复统一走标准平台接口，工具层不直连 event.reply
                const api = StandardBotApi.fromContext({ event })
                const sent = await api.reply(...replyArgs)
                return sent?.result ?? sent
            },
            writable: true,
            configurable: true,
            enumerable: true
        }
    })
    return commandEvent
}

async function searchCommands(loaderInstance, args, event, scope) {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return { success: false, action: 'search', error: 'search 操作必须提供 query' }
    if (query.length > MAX_QUERY_LENGTH) {
        return { success: false, action: 'search', error: `query 不能超过 ${MAX_QUERY_LENGTH} 个字符` }
    }
    if (/\r|\n|\0/.test(query)) {
        return { success: false, action: 'search', error: 'query 只能包含单行文本' }
    }

    const keyword = query.toLowerCase()
    const matches = []
    let scannedRules = 0
    let filteredRules = 0

    for (const item of loaderInstance.priority || []) {
        const rules = item?.plugin?.rule
        if (!Array.isArray(rules)) continue

        for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
            const rule = rules[ruleIndex]
            if (!normalizeReg(rule?.reg)) continue
            scannedRules++

            if (
                isRecursivePlugin(item) ||
                !(await hasRulePermission(loaderInstance, event, rule)) ||
                !(await eventMatches(loaderInstance, event, rule))
            ) {
                filteredRules++
                continue
            }

            const readable = regToReadable(rule.reg)
            const fnc = String(rule.fnc || '')
            const pluginName = String(item.name || '')
            const pluginDescription = String(item.plugin?.dsc || '')
            const haystack = `${readable}\n${fnc}\n${pluginName}\n${pluginDescription}`.toLowerCase()
            const exactMatch = regMatches(rule.reg, query)
            if (!exactMatch && !haystack.includes(keyword)) continue

            let score = exactMatch ? 0 : 20
            if (readable.toLowerCase().includes(keyword)) score -= 6
            if (fnc.toLowerCase().includes(keyword)) score -= 3
            if (pluginName.toLowerCase().includes(keyword)) score -= 2

            matches.push({
                item,
                rule,
                ruleIndex,
                readable,
                exactMatch,
                score,
                priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 99999
            })
        }
    }

    matches.sort(
        (a, b) =>
            a.score - b.score ||
            a.priority - b.priority ||
            String(a.item.name).localeCompare(String(b.item.name), 'zh-CN')
    )

    const now = Date.now()
    const selected = matches.slice(0, MAX_RESULTS)
    const resultCandidates = selected.map(match => {
        const candidateId = createCandidateId()
        const fingerprint = ruleFingerprint(match.item, match.rule, match.ruleIndex)
        commandCandidates.set(candidateId, {
            scope: scopeKey(scope),
            createdAt: now,
            expiresAt: now + CANDIDATE_TTL,
            fingerprint
        })

        const normalized = normalizeReg(match.rule.reg)
        return {
            candidate_id: candidateId,
            plugin: String(match.item.name || '未知插件'),
            plugin_file: String(match.item.key || ''),
            description: String(match.item.plugin?.dsc || '').slice(0, 120),
            function: String(match.rule.fnc || ''),
            command_pattern: match.readable,
            regex: normalized?.toString() || '',
            permission: normalizePermission(match.rule.permission),
            priority: match.priority,
            exact_match: match.exactMatch
        }
    })

    pruneState(now)
    return {
        success: true,
        action: 'search',
        query,
        candidates: resultCandidates,
        returned: resultCandidates.length,
        matched_total: matches.length,
        scanned_rules: scannedRules,
        unavailable_rules: filteredRules,
        expires_in_seconds: CANDIDATE_TTL / 1000,
        message:
            resultCandidates.length > 0
                ? '请选择最合适的 candidate_id，并用 execute 提交与其正则匹配的完整 command。'
                : '没有找到当前用户有权执行的匹配命令。请缩短关键词后再搜索。'
    }
}

async function executeCommand(loaderInstance, args, event, scope) {
    const candidateId = typeof args.candidate_id === 'string' ? args.candidate_id.trim() : ''
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!candidateId || !command) {
        return { success: false, action: 'execute', error: 'execute 操作必须提供 candidate_id 和 command' }
    }
    if (command.length > MAX_COMMAND_LENGTH) {
        return { success: false, action: 'execute', error: `command 不能超过 ${MAX_COMMAND_LENGTH} 个字符` }
    }
    if (/\r|\n|\0/.test(command)) {
        return { success: false, action: 'execute', error: '只允许执行单条、单行命令' }
    }
    const now = Date.now()
    pruneState(now)
    const record = commandCandidates.get(candidateId)
    if (!record) {
        return { success: false, action: 'execute', error: '候选 ID 不存在或已过期，请重新搜索' }
    }
    if (record.expiresAt <= now) {
        commandCandidates.delete(candidateId)
        return { success: false, action: 'execute', error: '候选 ID 已过期，请重新搜索' }
    }
    if (record.scope !== scopeKey(scope)) {
        return { success: false, action: 'execute', error: '候选 ID 不属于当前机器人、用户或会话' }
    }

    const current = findCurrentRule(loaderInstance, record.fingerprint)
    if (!current) {
        commandCandidates.delete(candidateId)
        return { success: false, action: 'execute', error: '插件规则已变化，请重新搜索' }
    }
    const { item, rule } = current
    if (isRecursivePlugin(item)) {
        commandCandidates.delete(candidateId)
        return { success: false, action: 'execute', error: '不能通过该工具递归调用 chatgpt-plugin 自身命令' }
    }
    if (!(await hasRulePermission(loaderInstance, event, rule))) {
        commandCandidates.delete(candidateId)
        return { success: false, action: 'execute', error: '当前用户已不具备执行该规则的权限' }
    }
    if (!regMatches(rule.reg, command)) {
        return { success: false, action: 'execute', error: 'command 与所选候选的正则规则不匹配' }
    }

    let replyCount = 0
    const commandEvent = cloneEventForCommand(event, command, () => {
        replyCount++
    })
    if (!(await eventMatches(loaderInstance, commandEvent, rule))) {
        return { success: false, action: 'execute', error: '该规则不适用于当前消息事件类型' }
    }
    if (!(await checkExecutionPermission(loaderInstance, commandEvent, rule))) {
        return { success: false, action: 'execute', error: '当前用户没有执行该规则的权限' }
    }

    const repeatKey = `${record.scope}\u0001${candidateId}\u0001${command}`
    GLOBAL_COMMAND_LOADER.recentExecutions ||= new Map()
    const previousExecution = GLOBAL_COMMAND_LOADER.recentExecutions.get(repeatKey)
    if (previousExecution && now - previousExecution < REPEAT_WINDOW) {
        return {
            success: false,
            action: 'execute',
            error: `相同命令刚刚执行过，请等待 ${Math.ceil((REPEAT_WINDOW - (now - previousExecution)) / 1000)} 秒`
        }
    }
    GLOBAL_COMMAND_LOADER.recentExecutions.set(repeatKey, now)

    const fnc = String(rule.fnc || '')
    let instance
    try {
        instance = Object.assign(new item.class(commandEvent), { e: commandEvent })
    } catch (error) {
        if (typeof item?.plugin !== 'function') {
            return { success: false, action: 'execute', error: `目标插件初始化失败：${safeError(error)}` }
        }
        try {
            instance = Object.assign(new item.plugin(commandEvent), { e: commandEvent })
        } catch (fallbackError) {
            return { success: false, action: 'execute', error: `目标插件初始化失败：${safeError(error)}` }
        }
    }
    if (!fnc || typeof instance[fnc] !== 'function') {
        return { success: false, action: 'execute', error: '目标插件的处理函数不存在' }
    }

    const timeoutToken = Symbol('timeout')
    let timeoutId
    const execution = Promise.resolve().then(() => instance[fnc](commandEvent))
    const timeout = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve(timeoutToken), EXECUTION_TIMEOUT)
        timeoutId.unref?.()
    })

    try {
        const result = await Promise.race([execution, timeout])
        if (result === timeoutToken) {
            execution.catch(error => global.logger?.error?.('[yunzai_command] 超时后的插件执行失败', error))
            return {
                success: false,
                action: 'execute',
                timed_out: true,
                plugin: String(item.name || ''),
                function: fnc,
                reply_count: replyCount,
                error: `插件执行超过 ${EXECUTION_TIMEOUT / 1000} 秒；任务可能仍在后台完成`
            }
        }
        if (result === false) {
            return {
                success: false,
                action: 'execute',
                handled: false,
                plugin: String(item.name || ''),
                function: fnc,
                reply_count: replyCount,
                message: '该候选规则拒绝处理此命令，可重新搜索或选择其他候选。'
            }
        }
        return {
            success: true,
            action: 'execute',
            handled: true,
            plugin: String(item.name || ''),
            plugin_file: String(item.key || ''),
            function: fnc,
            reply_count: replyCount,
            message: replyCount > 0 ? '命令已执行，插件回复已直接发送给用户。' : '命令已执行，但插件没有调用 reply。'
        }
    } catch (error) {
        return {
            success: false,
            action: 'execute',
            plugin: String(item.name || ''),
            function: fnc,
            reply_count: replyCount,
            error: `插件执行失败：${safeError(error)}`
        }
    } finally {
        clearTimeout(timeoutId)
    }
}

export const yunzaiCommandTools = [
    {
        name: 'yunzai_command',
        description:
            '按当前触发者权限搜索并执行 Yunzai 已加载的插件命令。必须先用 search 查找候选，再用短期 candidate_id 执行；不要猜测 candidate_id。',
        inputSchema,
        handler: async (args, ctx) => {
            const event = ctx?.getEvent?.()
            const canReply = event && typeof event.reply === 'function'
            if (!event || !canReply) {
                return { success: false, error: '当前没有可用于执行 Yunzai 命令的消息事件' }
            }

            const scope = getScope(event)
            if (!scope.botId || !scope.userId) {
                return { success: false, error: '无法确认当前机器人或用户身份，已拒绝调用' }
            }
            const scopeError = validateProvidedScope(args, scope)
            if (scopeError) return { success: false, error: scopeError }

            // action 白名单先于环境检查，保证错误信息与请求参数一一对应
            if (args.action !== 'search' && args.action !== 'execute') {
                return { success: false, error: 'action 只能是 search 或 execute' }
            }

            const loaderInstance = await resolveYunzaiLoaderManager()
            if (!loaderInstance) {
                return { success: false, error: '无法访问 Yunzai 插件加载器（可能未在 Yunzai 进程中运行）' }
            }

            pruneState()
            if (args.action === 'search') return await searchCommands(loaderInstance, args, event, scope)
            if (args.action === 'execute') return await executeCommand(loaderInstance, args, event, scope)
            return { success: false, error: 'action 只能是 search 或 execute' }
        }
    }
]
