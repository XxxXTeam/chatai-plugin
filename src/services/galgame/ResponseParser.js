/**
 * @fileoverview Galgame AI响应解析器
 * @module services/galgame/ResponseParser
 */

/**
 * 解析AI回复中的所有标记
 * 支持格式：
 * - [好感度:+X] 或 [好感度:-X]
 * - [选项1:文本] [选项2:文本] ...
 * - [触发事件:名称|描述|成功率]
 * - [事件选项1:文本|成功好感度|失败好感度]
 * - [当前场景:场景名称|场景描述]
 * - [当前任务:任务描述]
 * - [线索:信息]
 * - [剧情:因果链]
 * - [发现:类型|内容]
 *
 * @param {string} response - AI原始响应文本
 * @returns {Object} 解析结果
 */
export function parseResponse(response) {
    let cleanResponse = response
    const result = {
        affectionChange: 0,
        options: [],
        event: null,
        eventOptions: [],
        scene: null,
        task: null,
        clue: null,
        plot: null,
        discoveries: []
    }

    // 解析当前场景 [当前场景:场景名称|场景描述]
    const scenePattern = /\[当前场景:([^|\]]+)\|?([^\]]*)\]/
    const sceneMatch = response.match(scenePattern)
    if (sceneMatch) {
        result.scene = {
            name: sceneMatch[1].trim(),
            description: sceneMatch[2]?.trim() || ''
        }
    }
    cleanResponse = cleanResponse.replace(scenePattern, '').trim()

    // 解析当前任务 [当前任务:任务描述]
    const taskPattern = /\[当前任务:([^\]]+)\]/
    const taskMatch = response.match(taskPattern)
    if (taskMatch) {
        result.task = taskMatch[1].trim()
    }
    cleanResponse = cleanResponse.replace(taskPattern, '').trim()

    // 解析线索 [线索:已发现的重要信息]
    const cluePattern = /\[线索:([^\]]+)\]/
    const clueMatch = response.match(cluePattern)
    if (clueMatch) {
        result.clue = clueMatch[1].trim()
    }
    cleanResponse = cleanResponse.replace(cluePattern, '').trim()

    // 解析剧情因果 [剧情:因为XX → 发生YY → 导致ZZ]
    const plotPattern = /\[剧情:([^\]]+)\]/
    const plotMatch = response.match(plotPattern)
    if (plotMatch) {
        result.plot = plotMatch[1].trim()
    }
    cleanResponse = cleanResponse.replace(plotPattern, '').trim()

    // 解析信息发现 [发现:类型|内容]
    const discoveryPattern = /\[发现:([^|\]]+)\|([^\]]+)\]/g
    const discoveryMatches = [...response.matchAll(discoveryPattern)]
    for (const match of discoveryMatches) {
        result.discoveries.push({
            type: match[1].trim(),
            content: match[2].trim()
        })
    }
    cleanResponse = cleanResponse.replace(discoveryPattern, '').trim()

    // 解析好感度变化 [好感度:+X] 或 [好感度:-X]
    const affectionPattern = /\[好感度:([+-]?\d+)\]/g
    const affectionMatches = [...response.matchAll(affectionPattern)]
    if (affectionMatches.length > 0) {
        // 取最后一个好感度变化
        const lastMatch = affectionMatches[affectionMatches.length - 1]
        result.affectionChange = parseInt(lastMatch[1])
        result.affectionChange = Math.max(-10, Math.min(10, result.affectionChange))
    }
    cleanResponse = cleanResponse.replace(affectionPattern, '').trim()

    // 解析对话选项 [选项1:文本]
    const optionPattern = /\[选项(\d):([^\]]+)\]/g
    const optionMatches = [...response.matchAll(optionPattern)]
    for (const match of optionMatches) {
        const index = parseInt(match[1])
        if (index >= 1 && index <= 4) {
            result.options.push({
                index,
                text: match[2].trim()
            })
        }
    }
    // 最多4个选项
    result.options = result.options.slice(0, 4)
    cleanResponse = cleanResponse.replace(optionPattern, '').trim()

    // 解析触发事件 [触发事件:名称|描述|成功率]
    const eventPattern = /\[触发事件:([^|\]]+)\|([^|\]]+)\|(\d+)\]/
    const eventMatch = response.match(eventPattern)
    if (eventMatch) {
        result.event = {
            name: eventMatch[1].trim(),
            description: eventMatch[2].trim(),
            successRate: Math.min(100, Math.max(0, parseInt(eventMatch[3])))
        }
    }
    cleanResponse = cleanResponse.replace(eventPattern, '').trim()

    // 解析事件选项 [事件选项1:文本|成功好感度|失败好感度]
    const eventOptionPattern = /\[事件选项(\d):([^|\]]+)\|([+-]?\d+)\|([+-]?\d+)\]/g
    const eventOptionMatches = [...response.matchAll(eventOptionPattern)]
    for (const match of eventOptionMatches) {
        const index = parseInt(match[1])
        if (index >= 1 && index <= 4) {
            result.eventOptions.push({
                index,
                text: match[2].trim(),
                successAffection: parseInt(match[3]),
                failAffection: parseInt(match[4])
            })
        }
    }
    result.eventOptions = result.eventOptions.slice(0, 4)
    cleanResponse = cleanResponse.replace(eventOptionPattern, '').trim()

    // 清理多余的换行
    cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim()

    return {
        cleanResponse,
        ...result
    }
}

/**
 * 解析初始化响应，提取环境设定
 * @param {string} response - AI生成的环境设定响应
 * @returns {Object} 解析后的环境设定
 */
export function parseInitResponse(response) {
    const result = {
        name: null,
        world: null,
        identity: null,
        personality: null,
        likes: null,
        dislikes: null,
        background: null,
        secret: null,
        scene: null,
        meetingReason: null,
        greeting: null
    }

    // 匹配单行内容，[字段:内容]格式
    const patterns = {
        name: /\[角色名[:：]([^\]\n]+)\]/,
        world: /\[世界观[:：]([^\]\n]+)\]/,
        identity: /\[身份[:：]([^\]\n]+)\]/,
        personality: /\[性格[:：]([^\]\n]+)\]/,
        likes: /\[喜好[:：]([^\]\n]+)\]/,
        dislikes: /\[厌恶[:：]([^\]\n]+)\]/,
        background: /\[背景[:：]([^\]\n]+)\]/,
        secret: /\[秘密[:：]([^\]\n]+)\]/,
        scene: /\[场景[:：]([^\]\n]+)\]/,
        meetingReason: /\[相遇原因[:：]([^\]\n]+)\]/,
        greeting: /\[开场白[:：]([^\]\n]+)\]/
    }

    for (const [key, pattern] of Object.entries(patterns)) {
        const match = response.match(pattern)
        if (match) {
            result[key] = match[1].trim()
        }
    }

    return result
}

/**
 * 从AI响应内容数组中提取纯文本
 * @param {Array|Object} content - AI响应的content字段
 * @returns {string} 提取的文本内容
 */
export function extractTextFromContent(content) {
    if (!content) return ''

    const contentArray = Array.isArray(content) ? content : [content]
    return contentArray
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('')
}

/**
 * 处理事件选择结果
 * @param {Object} eventInfo - 事件信息
 * @param {number} optionIndex - 选择的选项索引
 * @param {Array} options - 可选项列表
 * @returns {Object} 处理结果
 */
export function processEventChoice(eventInfo, optionIndex, options) {
    const option = options.find(o => o.index === optionIndex)
    if (!option) {
        return { success: false, message: '无效选项', affectionChange: 0 }
    }

    // 根据成功率随机判定
    const roll = Math.random() * 100
    const success = roll < eventInfo.successRate

    const affectionChange = success ? option.successAffection : option.failAffection

    return {
        success,
        eventName: eventInfo.name,
        optionText: option.text,
        message: success ? '成功！' : '失败...',
        affectionChange,
        roll: roll.toFixed(1),
        rate: eventInfo.successRate
    }
}

/**
 * 处理事件的自定义文本输入
 * @param {Object} eventInfo - 事件信息
 * @param {string} customInput - 用户自定义输入
 * @param {Array} options - 可选项列表（用于获取基准好感度）
 * @returns {Object} 处理结果
 */
export function processEventWithCustomInput(eventInfo, customInput, options) {
    // 根据成功率随机判定
    const roll = Math.random() * 100
    const success = roll < eventInfo.successRate

    // 使用第一个选项的好感度变化作为基准，或使用默认值
    const baseOption = options[0] || { successAffection: 10, failAffection: -5 }
    const affectionChange = success ? baseOption.successAffection : baseOption.failAffection

    return {
        success,
        eventName: eventInfo.name,
        optionText: customInput,
        message: success ? '成功！' : '失败...',
        affectionChange,
        roll: roll.toFixed(1),
        rate: eventInfo.successRate,
        isCustomInput: true
    }
}
