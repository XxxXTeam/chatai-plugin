import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'acorn'

const NO_CONSTANT = Symbol('no-constant')

const DIRECT_PROTOCOL_METHODS = new Set([
    'pickGroup',
    'pickFriend',
    'pickUser',
    'pickMember',
    'sendApi',
    'sendGroupMsg',
    'sendPrivateMsg',
    'send_group_msg',
    'send_private_msg',
    'getMsg',
    'getForwardMsg',
    'getChatHistory',
    'getGroupMap',
    'getFriendMap',
    'getMemberMap',
    'getNoticeList',
    'sendMsg',
    'sendForwardMsg',
    'recallMsg',
    'setGroupKick',
    'setGroupKickBan',
    'setGroupAdmin',
    'setGroupSpecialTitle',
    'sendOidbSvcTrpcTcp',
    'sendOidb',
    'sendUni',
    'writeUni',
    'sendPacket',
    'sendMergeUni'
])

const RAW_BOT_PROTOCOL_PROPERTIES = new Set([
    'adapter',
    'apk',
    'bkn',
    'bots',
    'cookies',
    'fl',
    'gl',
    'gml',
    'guild_id',
    'group_openid',
    'member_openid',
    'openid',
    'protocol',
    'qq',
    'sdk',
    'self_id',
    'sig',
    'stat',
    'uin',
    'version'
])

const EXCLUDED_BUSINESS_FILES = new Set(['src/mcp/tools/helpers.js', 'src/services/tools/CustomToolService.js'])

function emptyValue() {
    return { kinds: new Set(), constant: NO_CONSTANT }
}

function valueWithKind(kind) {
    return { kinds: new Set([kind]), constant: NO_CONSTANT }
}

function constantValue(constant) {
    return { kinds: new Set(), constant }
}

function mergeValues(...values) {
    const result = emptyValue()
    for (const value of values) {
        for (const kind of value?.kinds || []) result.kinds.add(kind)
    }
    const constants = values.map(value => value?.constant ?? NO_CONSTANT)
    if (constants.length > 0 && constants.every(value => value !== NO_CONSTANT && value === constants[0])) {
        result.constant = constants[0]
    }
    return result
}

function hasKind(value, kind) {
    return value?.kinds?.has(kind) === true
}

function createScope(parent = null) {
    return { parent, bindings: new Map() }
}

function lookupBinding(scope, name) {
    for (let current = scope; current; current = current.parent) {
        if (current.bindings.has(name)) return current.bindings.get(name)
    }
    return emptyValue()
}

function declareBinding(scope, name, value) {
    scope.bindings.set(name, value || emptyValue())
}

function assignBinding(scope, name, value) {
    for (let current = scope; current; current = current.parent) {
        if (current.bindings.has(name)) {
            current.bindings.set(name, value || emptyValue())
            return
        }
    }
    declareBinding(scope, name, value)
}

function unwrapChain(node) {
    let current = node
    while (current?.type === 'ChainExpression') current = current.expression
    return current
}

function evaluateConstant(node, scope) {
    const current = unwrapChain(node)
    if (!current) return NO_CONSTANT
    if (current.type === 'Literal') return current.value
    if (current.type === 'Identifier') return lookupBinding(scope, current.name).constant
    if (current.type === 'TemplateLiteral') {
        let result = current.quasis[0]?.value?.cooked ?? ''
        for (let index = 0; index < current.expressions.length; index += 1) {
            const value = evaluateConstant(current.expressions[index], scope)
            if (value === NO_CONSTANT) return NO_CONSTANT
            result += String(value)
            result += current.quasis[index + 1]?.value?.cooked ?? ''
        }
        return result
    }
    if (current.type === 'BinaryExpression' && current.operator === '+') {
        const left = evaluateConstant(current.left, scope)
        const right = evaluateConstant(current.right, scope)
        if (left === NO_CONSTANT || right === NO_CONSTANT) return NO_CONSTANT
        return left + right
    }
    return NO_CONSTANT
}

function getStaticPropertyName(node, scope) {
    const current = unwrapChain(node)
    if (!current?.computed && current?.property?.type === 'Identifier') return current.property.name
    if (!current?.computed) return null
    const value = evaluateConstant(current.property, scope)
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function getPatternPropertyName(node, scope) {
    if (!node?.computed && node?.key?.type === 'Identifier') return node.key.name
    if (!node?.computed && node?.key?.type === 'Literal') return String(node.key.value)
    if (!node?.computed) return null
    const value = evaluateConstant(node.key, scope)
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function isDirectMemberUse(node, parent, scope) {
    const currentParent = unwrapChain(parent)
    if (currentParent?.type === 'CallExpression' && unwrapChain(currentParent.callee) === node) return true
    if (currentParent?.type !== 'MemberExpression' || unwrapChain(currentParent.object) !== node) return false
    return ['apply', 'bind', 'call'].includes(getStaticPropertyName(currentParent, scope))
}

function isIdentifier(node, name) {
    return unwrapChain(node)?.type === 'Identifier' && unwrapChain(node).name === name
}

function evaluateExpression(node, scope) {
    const current = unwrapChain(node)
    if (!current) return emptyValue()
    switch (current.type) {
        case 'Identifier':
            if (current.name === 'Bot') return valueWithKind('rawBot')
            return lookupBinding(scope, current.name)
        case 'Literal':
            return constantValue(current.value)
        case 'TemplateLiteral': {
            const value = evaluateConstant(current, scope)
            return value === NO_CONSTANT ? emptyValue() : constantValue(value)
        }
        case 'AwaitExpression':
        case 'TSAsExpression':
            return evaluateExpression(current.argument || current.expression, scope)
        case 'AssignmentExpression':
            return evaluateExpression(current.right, scope)
        case 'ConditionalExpression':
            return mergeValues(
                evaluateExpression(current.consequent, scope),
                evaluateExpression(current.alternate, scope)
            )
        case 'LogicalExpression':
            return mergeValues(evaluateExpression(current.left, scope), evaluateExpression(current.right, scope))
        case 'SequenceExpression':
            return current.expressions.length
                ? evaluateExpression(current.expressions[current.expressions.length - 1], scope)
                : emptyValue()
        case 'NewExpression':
            if (isIdentifier(current.callee, 'StandardRawApi')) return valueWithKind('standardRawApi')
            if (isIdentifier(current.callee, 'StandardBotApi')) return valueWithKind('standardBotApi')
            return emptyValue()
        case 'CallExpression': {
            const callee = unwrapChain(current.callee)
            if (callee?.type === 'MemberExpression') {
                const property = getStaticPropertyName(callee, scope)
                const receiver = evaluateExpression(callee.object, scope)
                if (property === 'getEvent') return valueWithKind('event')
                if (property === 'getBot') return valueWithKind('rawBot')
                if (property === 'capabilities' && hasKind(receiver, 'standardRawApi')) {
                    return valueWithKind('standardCapabilities')
                }
                if (property === 'fromContext') {
                    if (isIdentifier(callee.object, 'StandardRawApi')) return valueWithKind('standardRawApi')
                    if (isIdentifier(callee.object, 'StandardBotApi')) return valueWithKind('standardBotApi')
                }
            }
            return emptyValue()
        }
        case 'MemberExpression': {
            const property = getStaticPropertyName(current, scope)
            const receiver = evaluateExpression(current.object, scope)
            const result = emptyValue()
            if (property === 'event') result.kinds.add('event')
            if (property === 'bot') result.kinds.add('rawBot')
            if (isIdentifier(current.object, 'globalThis') && property === 'Bot') result.kinds.add('rawBot')
            if (DIRECT_PROTOCOL_METHODS.has(property) && !hasKind(receiver, 'standardCapabilities')) {
                result.kinds.add('protocolMethod')
            }
            return result
        }
        default: {
            const constant = evaluateConstant(current, scope)
            return constant === NO_CONSTANT ? emptyValue() : constantValue(constant)
        }
    }
}

function walkPatternExpressions(pattern, scope, visit) {
    if (!pattern) return
    if (pattern.type === 'AssignmentPattern') {
        visit(pattern.right, scope, pattern)
        walkPatternExpressions(pattern.left, scope, visit)
        return
    }
    if (pattern.type === 'RestElement') {
        walkPatternExpressions(pattern.argument, scope, visit)
        return
    }
    if (pattern.type === 'ObjectPattern') {
        for (const property of pattern.properties) {
            if (property.type === 'RestElement') {
                walkPatternExpressions(property.argument, scope, visit)
                continue
            }
            if (property.computed) visit(property.key, scope, property)
            walkPatternExpressions(property.value, scope, visit)
        }
        return
    }
    if (pattern.type === 'ArrayPattern') {
        for (const element of pattern.elements) walkPatternExpressions(element, scope, visit)
    }
}

function formatViolation({ code, property, filename, node, message }) {
    return {
        code,
        property: property || null,
        filename,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        message
    }
}

/**
 * 对单个业务源码执行标准 Bot API 结构审计。
 * @param {string} source - JavaScript ESM 源码
 * @param {{filename?: string}} [options] - 分析选项
 * @returns {Array<{code:string,property:string|null,filename:string,line:number,column:number,message:string}>} 违规列表
 */
export function analyzeStandardBotBusinessSource(source, options = {}) {
    const filename = options.filename || '<memory>'
    let ast
    try {
        ast = parse(source, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowHashBang: true,
            locations: true
        })
    } catch (error) {
        error.message = `${filename}: ${error.message}`
        throw error
    }

    const violations = []
    const seen = new Set()
    const addViolation = (code, node, property, message) => {
        const key = `${code}:${node.start}:${property || ''}`
        if (seen.has(key)) return
        seen.add(key)
        violations.push(formatViolation({ code, property, filename, node, message }))
    }

    const bindPattern = (pattern, value, scope, mode = 'declare') => {
        if (!pattern) return
        if (pattern.type === 'Identifier') {
            if (mode === 'assign') assignBinding(scope, pattern.name, value)
            else declareBinding(scope, pattern.name, value)
            return
        }
        if (pattern.type === 'AssignmentPattern') {
            bindPattern(pattern.left, value, scope, mode)
            return
        }
        if (pattern.type === 'RestElement') {
            bindPattern(pattern.argument, emptyValue(), scope, mode)
            return
        }
        if (pattern.type === 'ArrayPattern') {
            for (const element of pattern.elements) bindPattern(element, emptyValue(), scope, mode)
            return
        }
        if (pattern.type !== 'ObjectPattern') return

        for (const propertyNode of pattern.properties) {
            if (propertyNode.type === 'RestElement') {
                bindPattern(propertyNode.argument, emptyValue(), scope, mode)
                continue
            }
            const property = getPatternPropertyName(propertyNode, scope)
            let propertyValue = emptyValue()
            if (property === 'event') propertyValue = valueWithKind('event')
            if (property === 'bot') propertyValue = valueWithKind('rawBot')
            if (hasKind(value, 'event') && property === 'bot') {
                addViolation(
                    'RAW_EVENT_BOT_ACCESS',
                    propertyNode,
                    property,
                    '业务代码不得从事件对象读取原始 bot；请使用 StandardBotApi.fromContext(ctx)'
                )
            }
            if (DIRECT_PROTOCOL_METHODS.has(property) && !hasKind(value, 'standardCapabilities')) {
                propertyValue = valueWithKind('protocolMethod')
                addViolation(
                    'DIRECT_PROTOCOL_DESTRUCTURE',
                    propertyNode,
                    property,
                    `不得解构协议方法 ${property}；请使用 StandardBotApi/StandardFileApi/StandardRawApi`
                )
            } else if (hasKind(value, 'rawBot') && RAW_BOT_PROTOCOL_PROPERTIES.has(property)) {
                addViolation(
                    'RAW_BOT_PROTOCOL_PROPERTY',
                    propertyNode,
                    property,
                    `不得解构原始 Bot 协议属性 ${property}；请使用标准平台接口`
                )
            } else if (hasKind(value, 'rawBot') && property === null && propertyNode.computed) {
                addViolation(
                    'DYNAMIC_RAW_BOT_PROPERTY',
                    propertyNode,
                    null,
                    '不得通过动态属性访问原始 Bot；请使用标准平台接口的显式方法'
                )
            }
            bindPattern(propertyNode.value, propertyValue, scope, mode)
        }
    }

    const visit = (node, scope, parent = null) => {
        if (!node || typeof node.type !== 'string') return
        switch (node.type) {
            case 'Program':
                for (const statement of node.body) visit(statement, scope, node)
                return
            case 'BlockStatement': {
                const blockScope = createScope(scope)
                for (const statement of node.body) visit(statement, blockScope, node)
                return
            }
            case 'ImportDeclaration':
                for (const specifier of node.specifiers) declareBinding(scope, specifier.local.name, emptyValue())
                return
            case 'VariableDeclaration':
                for (const declaration of node.declarations) {
                    if (declaration.init) visit(declaration.init, scope, declaration)
                    walkPatternExpressions(declaration.id, scope, visit)
                    bindPattern(declaration.id, evaluateExpression(declaration.init, scope), scope)
                }
                return
            case 'FunctionDeclaration': {
                if (node.id) declareBinding(scope, node.id.name, emptyValue())
                const functionScope = createScope(scope)
                for (const parameter of node.params) {
                    walkPatternExpressions(parameter, functionScope, visit)
                    bindPattern(parameter, emptyValue(), functionScope)
                }
                visit(node.body, functionScope, node)
                return
            }
            case 'FunctionExpression':
            case 'ArrowFunctionExpression': {
                const functionScope = createScope(scope)
                if (node.type === 'FunctionExpression' && node.id) {
                    declareBinding(functionScope, node.id.name, emptyValue())
                }
                for (const parameter of node.params) {
                    walkPatternExpressions(parameter, functionScope, visit)
                    bindPattern(parameter, emptyValue(), functionScope)
                }
                visit(node.body, functionScope, node)
                return
            }
            case 'AssignmentExpression': {
                visit(node.right, scope, node)
                walkPatternExpressions(node.left, scope, visit)
                const value = evaluateExpression(node.right, scope)
                if (node.left.type === 'Identifier' || node.left.type.endsWith('Pattern')) {
                    bindPattern(node.left, value, scope, 'assign')
                } else {
                    visit(node.left, scope, node)
                }
                return
            }
            case 'MemberExpression': {
                visit(node.object, scope, node)
                if (node.computed) visit(node.property, scope, node)
                const property = getStaticPropertyName(node, scope)
                const receiver = evaluateExpression(node.object, scope)
                if (
                    DIRECT_PROTOCOL_METHODS.has(property) &&
                    !hasKind(receiver, 'standardCapabilities') &&
                    (hasKind(receiver, 'rawBot') || isDirectMemberUse(node, parent, scope))
                ) {
                    addViolation(
                        'DIRECT_PROTOCOL_MEMBER',
                        node,
                        property,
                        `不得直接访问协议方法 ${property}；请使用 StandardBotApi/StandardFileApi/StandardRawApi`
                    )
                }
                if (hasKind(receiver, 'event') && property === 'bot') {
                    addViolation(
                        'RAW_EVENT_BOT_ACCESS',
                        node,
                        property,
                        '业务代码不得从事件对象读取原始 bot；请使用 StandardBotApi.fromContext(ctx)'
                    )
                }
                if (hasKind(receiver, 'rawBot') && RAW_BOT_PROTOCOL_PROPERTIES.has(property)) {
                    addViolation(
                        'RAW_BOT_PROTOCOL_PROPERTY',
                        node,
                        property,
                        `不得读取原始 Bot 协议属性 ${property}；请使用标准平台接口`
                    )
                }
                if (hasKind(receiver, 'rawBot') && node.computed && property === null) {
                    addViolation(
                        'DYNAMIC_RAW_BOT_PROPERTY',
                        node,
                        null,
                        '不得通过动态属性访问原始 Bot；请使用标准平台接口的显式方法'
                    )
                }
                return
            }
            case 'CallExpression': {
                visit(node.callee, scope, node)
                for (const argument of node.arguments) visit(argument, scope, node)
                if (hasKind(evaluateExpression(node.callee, scope), 'protocolMethod')) {
                    addViolation(
                        'ALIASED_PROTOCOL_CALL',
                        node,
                        null,
                        '不得通过变量别名调用协议方法；请使用标准平台接口'
                    )
                }
                const callee = unwrapChain(node.callee)
                if (callee?.type !== 'MemberExpression') return
                const method = getStaticPropertyName(callee, scope)
                if (method === 'getBot' || method === 'getAdapter') {
                    addViolation(
                        'LEGACY_CONTEXT_GETTER',
                        callee,
                        method,
                        `业务代码不得调用 ${method}()；请使用 StandardBotApi.fromContext(ctx)`
                    )
                }
                if (method !== 'get' || !isIdentifier(callee.object, 'Reflect') || node.arguments.length < 2) return
                const property = evaluateConstant(node.arguments[1], scope)
                const receiver = evaluateExpression(node.arguments[0], scope)
                if (DIRECT_PROTOCOL_METHODS.has(property)) {
                    addViolation(
                        'REFLECT_PROTOCOL_LOOKUP',
                        node,
                        property,
                        `不得通过 Reflect.get 访问协议方法 ${property}`
                    )
                } else if (hasKind(receiver, 'rawBot') && property === NO_CONSTANT) {
                    addViolation('DYNAMIC_RAW_BOT_PROPERTY', node, null, '不得通过 Reflect.get 动态访问原始 Bot')
                }
                return
            }
            case 'ChainExpression':
                visit(node.expression, scope, node)
                return
            case 'ClassDeclaration':
                if (node.id) declareBinding(scope, node.id.name, emptyValue())
                if (node.superClass) visit(node.superClass, scope, node)
                visit(node.body, createScope(scope), node)
                return
            case 'Property':
            case 'PropertyDefinition':
            case 'MethodDefinition':
                if (node.computed) visit(node.key, scope, node)
                if (node.value) visit(node.value, scope, node)
                return
            default:
                for (const [key, value] of Object.entries(node)) {
                    if (['type', 'start', 'end', 'loc', 'range'].includes(key)) continue
                    if (Array.isArray(value)) {
                        for (const child of value) visit(child, scope, node)
                    } else {
                        visit(value, scope, node)
                    }
                }
        }
    }

    visit(ast, createScope())
    return violations.sort(
        (left, right) => left.line - right.line || left.column - right.column || left.code.localeCompare(right.code)
    )
}

function listJavaScriptFiles(directory) {
    if (!fs.existsSync(directory)) return []
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name)
        return entry.isDirectory() ? listJavaScriptFiles(target) : entry.name.endsWith('.js') ? [target] : []
    })
}

/**
 * 列出需要执行标准平台接口门禁的业务源码。
 * @param {string} projectRoot - 插件根目录
 * @returns {string[]} 绝对文件路径
 */
export function listStandardBotApiBusinessFiles(projectRoot) {
    const roots = [path.join(projectRoot, 'src/mcp/tools'), path.join(projectRoot, 'src/services/tools')]
    return roots
        .flatMap(listJavaScriptFiles)
        .filter(file => !EXCLUDED_BUSINESS_FILES.has(path.relative(projectRoot, file).split(path.sep).join('/')))
        .sort()
}

/**
 * 扫描项目业务目录中的标准平台接口违规。
 * @param {string} projectRoot - 插件根目录
 * @returns {ReturnType<typeof analyzeStandardBotBusinessSource>} 违规列表
 */
export function scanStandardBotApiBusinessFiles(projectRoot) {
    return listStandardBotApiBusinessFiles(projectRoot).flatMap(file =>
        analyzeStandardBotBusinessSource(fs.readFileSync(file, 'utf8'), {
            filename: path.relative(projectRoot, file).split(path.sep).join('/')
        })
    )
}

/**
 * 将违规列表格式化为断言消息。
 * @param {ReturnType<typeof analyzeStandardBotBusinessSource>} violations - 违规列表
 * @returns {string} 多行错误说明
 */
export function formatStandardBotApiViolations(violations) {
    return violations
        .map(
            violation =>
                `${violation.filename}:${violation.line}:${violation.column} [${violation.code}] ${violation.message}`
        )
        .join('\n')
}
