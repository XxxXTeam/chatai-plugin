/**
 * @fileoverview Galgame AI响应解析器
 * @module services/galgame/ResponseParser
 */

/**
 * - [好感度:+X] 或 [好感度:-X]
 * - [选项1:文本] [选项2:文本] ...
 * - [触发事件:名称|描述|成功率]
 * - [事件选项1:文本|成功好感度|失败好感度]
 * - [当前场景:场景名称|场景描述]
 * - [当前任务:任务描述]
 * - [线索:信息]
 * - [剧情:因果链]
 * - [发现:类型|内容]
 * - [信任度:+X] 或 [信任度:-X]
 * - [金币:+X] 或 [金币:-X]
 * - [购买:物品名|价格]
 * - [获得物品:物品名|描述]
 *
 * @param {string} response - AI原始响应文本
 * @returns {Object} 解析结果
 */
export function parseResponse(response) {
    let cleanResponse = response
    const result = {
        affectionChange: 0,
        trustChange: 0,
        goldChange: 0,
        purchases: [],
        obtainedItems: [],
        usedItems: [], // [使用物品:物品名]
        requiredItems: [], // [需要物品:物品名]
        shop: null, // [商店:名称]
        shopItems: [], // [商品N:物品名|类型|价格|描述]
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
        const lastMatch = affectionMatches[affectionMatches.length - 1]
        result.affectionChange = parseInt(lastMatch[1])
        result.affectionChange = Math.max(-10, Math.min(10, result.affectionChange))
    }
    cleanResponse = cleanResponse.replace(affectionPattern, '').trim()

    // 解析信任度变化 [信任度:+X] 或 [信任度:-X]
    const trustPattern = /\[信任度:([+-]?\d+)\]/g
    const trustMatches = [...response.matchAll(trustPattern)]
    if (trustMatches.length > 0) {
        const lastMatch = trustMatches[trustMatches.length - 1]
        result.trustChange = parseInt(lastMatch[1])
        result.trustChange = Math.max(-10, Math.min(10, result.trustChange))
    }
    cleanResponse = cleanResponse.replace(trustPattern, '').trim()

    // 解析金币变化 [金币:+X] 或 [金币:-X]
    const goldPattern = /\[金币:([+-]?\d+)\]/g
    const goldMatches = [...response.matchAll(goldPattern)]
    for (const match of goldMatches) {
        result.goldChange += parseInt(match[1])
    }
    cleanResponse = cleanResponse.replace(goldPattern, '').trim()

    // 解析购买物品 [购买:物品名|价格]
    const purchasePattern = /\[购买:([^|\]]+)\|(\d+)\]/g
    const purchaseMatches = [...response.matchAll(purchasePattern)]
    for (const match of purchaseMatches) {
        const price = parseInt(match[2])
        result.purchases.push({
            name: match[1].trim(),
            price
        })
        result.goldChange -= price
    }
    cleanResponse = cleanResponse.replace(purchasePattern, '').trim()

    // 解析获得物品 [获得物品:物品名|类型|描述] 或 [获得物品:物品名|描述] 或 [获得物品:物品名]
    const itemPattern = /\[获得物品:([^|\]]+)\|?([^|\]]*)\|?([^\]]*)\]/g
    const itemMatches = [...response.matchAll(itemPattern)]
    for (const match of itemMatches) {
        const name = match[1].trim()
        const seg2 = match[2]?.trim() || ''
        const seg3 = match[3]?.trim() || ''

        // 判断是3段格式还是2段格式
        const validTypes = ['key', 'gift', 'consumable', 'clue']
        let type = 'consumable'
        let description = ''

        if (seg3) {
            // 3段: name|type|description
            type = validTypes.includes(seg2) ? seg2 : 'consumable'
            description = seg3
        } else if (seg2) {
            // 2段: name|description or name|type
            if (validTypes.includes(seg2)) {
                type = seg2
            } else {
                description = seg2
            }
        }

        result.obtainedItems.push({ name, type, description })
    }
    cleanResponse = cleanResponse.replace(itemPattern, '').trim()

    // 解析使用物品 [使用物品:物品名]
    const useItemPattern = /\[使用物品:([^\]]+)\]/g
    const useItemMatches = [...response.matchAll(useItemPattern)]
    for (const match of useItemMatches) {
        result.usedItems.push(match[1].trim())
    }
    cleanResponse = cleanResponse.replace(useItemPattern, '').trim()

    // 解析需要物品 [需要物品:物品名]
    const needItemPattern = /\[需要物品:([^\]]+)\]/g
    const needItemMatches = [...response.matchAll(needItemPattern)]
    for (const match of needItemMatches) {
        result.requiredItems.push(match[1].trim())
    }
    cleanResponse = cleanResponse.replace(needItemPattern, '').trim()

    // 解析商店 [商店:名称]
    const shopPattern = /\[商店:([^\]]+)\]/
    const shopMatch = response.match(shopPattern)
    if (shopMatch) {
        result.shop = shopMatch[1].trim()
    }
    cleanResponse = cleanResponse.replace(shopPattern, '').trim()

    // 解析商品 [商品N:物品名|类型|价格|描述]
    const goodsPattern = /\[商品\d+:([^|\]]+)\|([^|\]]+)\|(\d+)\|([^\]]+)\]/g
    const goodsMatches = [...response.matchAll(goodsPattern)]
    for (const match of goodsMatches) {
        result.shopItems.push({
            name: match[1].trim(),
            type: match[2].trim(),
            price: parseInt(match[3]),
            description: match[4].trim()
        })
    }
    cleanResponse = cleanResponse.replace(goodsPattern, '').trim()

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

    // 解析触发事件 - 新格式 [触发事件:名称|描述] 不含成功率
    const eventPatternSimple = /\[触发事件:([^|\]]+)\|([^|\]]+)\]/
    const eventMatchSimple = response.match(eventPatternSimple)
    if (eventMatchSimple && !eventMatchSimple[0].match(/\|\d+\]/)) {
        result.event = {
            name: eventMatchSimple[1].trim(),
            description: eventMatchSimple[2].trim(),
            successRate: null // 由系统随机生成
        }
    }
    cleanResponse = cleanResponse.replace(eventPatternSimple, '').trim()

    // 兼容旧格式 [触发事件:名称|描述|成功率]
    const eventPatternOld = /\[触发事件:([^|\]]+)\|([^|\]]+)\|(\d+)\]/
    const eventMatchOld = response.match(eventPatternOld)
    if (eventMatchOld && !result.event) {
        result.event = {
            name: eventMatchOld[1].trim(),
            description: eventMatchOld[2].trim(),
            successRate: Math.min(100, Math.max(0, parseInt(eventMatchOld[3])))
        }
    }
    cleanResponse = cleanResponse.replace(eventPatternOld, '').trim()
    // 新格式: 简化事件选项 [事件选项1:选项文本] 不含奖惩数值
    const eventOptionPatternSimple = /\[事件选项(\d):([^|\]]+)\]/g
    const eventOptionMatchesSimple = [...response.matchAll(eventOptionPatternSimple)]
    for (const match of eventOptionMatchesSimple) {
        const index = parseInt(match[1])
        if (index >= 1 && index <= 4) {
            result.eventOptions.push({
                index,
                text: match[2].trim(),
                successAffection: null, // 由系统随机生成
                successTrust: null,
                failAffection: null,
                failTrust: null
            })
        }
    }
    cleanResponse = cleanResponse.replace(eventOptionPatternSimple, '').trim()

    // 兼容旧格式: 带完整奖惩的事件选项
    const eventOptionPatternFull = /\[事件选项(\d):([^|\]]+)\|([+-]?\d+),([+-]?\d+)\|([+-]?\d+),([+-]?\d+)\]/g
    const eventOptionMatchesFull = [...response.matchAll(eventOptionPatternFull)]
    for (const match of eventOptionMatchesFull) {
        const index = parseInt(match[1])
        if (index >= 1 && index <= 4 && !result.eventOptions.find(o => o.index === index)) {
            result.eventOptions.push({
                index,
                text: match[2].trim(),
                successAffection: parseInt(match[3]),
                successTrust: parseInt(match[4]),
                failAffection: parseInt(match[5]),
                failTrust: parseInt(match[6])
            })
        }
    }
    cleanResponse = cleanResponse.replace(eventOptionPatternFull, '').trim()

    // 兼容旧格式: 只有好感度的事件选项
    const eventOptionPatternOld = /\[事件选项(\d):([^|\]]+)\|([+-]?\d+)\|([+-]?\d+)\]/g
    const eventOptionMatchesOld = [...response.matchAll(eventOptionPatternOld)]
    for (const match of eventOptionMatchesOld) {
        const index = parseInt(match[1])
        if (index >= 1 && index <= 4 && !result.eventOptions.find(o => o.index === index)) {
            result.eventOptions.push({
                index,
                text: match[2].trim(),
                successAffection: parseInt(match[3]),
                successTrust: 0,
                failAffection: parseInt(match[4]),
                failTrust: 0
            })
        }
    }
    result.eventOptions = result.eventOptions.slice(0, 4)
    cleanResponse = cleanResponse.replace(eventOptionPatternOld, '').trim()

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
        greeting: null,
        summary: null
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
        greeting: /\[开场白[:：]([^\]\n]+)\]/,
        summary: /\[前情提要[:：]([^\]]+)\]/
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
 * 生成随机奖惩数值
 * @returns {Object} 随机生成的奖惩配置
 */
export function generateRandomRewards() {
    // 成功奖励: 好感+1~8, 信任+0~5, 金币+0~30
    // 失败惩罚: 好感-1~-5, 信任-1~-3, 金币0
    return {
        successRate: Math.floor(Math.random() * 60) + 20, // 20-80%
        successAffection: Math.floor(Math.random() * 8) + 1,
        successTrust: Math.floor(Math.random() * 6),
        successGold: Math.floor(Math.random() * 31),
        failAffection: -(Math.floor(Math.random() * 5) + 1),
        failTrust: -(Math.floor(Math.random() * 3) + 1),
        failGold: 0
    }
}

/**
 * 处理事件选择结果 - 支持随机生成概率和奖惩
 * @param {Object} eventInfo - 事件信息
 * @param {number} optionIndex - 选择的选项索引
 * @param {Array} options - 可选项列表
 * @returns {Object} 处理结果
 */
export function processEventChoice(eventInfo, optionIndex, options) {
    const option = options.find(o => o.index === optionIndex)
    if (!option) {
        return { success: false, message: '无效选项', affectionChange: 0, trustChange: 0, goldChange: 0 }
    }

    // 如果成功率为null，随机生成
    const successRate = eventInfo.successRate ?? Math.floor(Math.random() * 60) + 20

    // 如果奖惩为null，随机生成
    const rewards = generateRandomRewards()
    const successAffection = option.successAffection ?? rewards.successAffection
    const successTrust = option.successTrust ?? rewards.successTrust
    const failAffection = option.failAffection ?? rewards.failAffection
    const failTrust = option.failTrust ?? rewards.failTrust

    // 根据成功率随机判定
    const roll = Math.random() * 100
    const success = roll < successRate

    const affectionChange = success ? successAffection : failAffection
    const trustChange = success ? successTrust : failTrust
    const goldChange = success ? rewards.successGold : rewards.failGold

    return {
        success,
        eventName: eventInfo.name,
        optionText: option.text,
        message: success ? '成功！' : '失败...',
        affectionChange,
        trustChange,
        goldChange,
        roll: roll.toFixed(1),
        rate: successRate
    }
}

/**
 * 处理事件的自定义文本输入 - 支持随机生成
 * @param {Object} eventInfo - 事件信息
 * @param {string} customInput - 用户自定义输入
 * @param {Array} options - 可选项列表（用于获取基准好感度）
 * @returns {Object} 处理结果
 */
export function processEventWithCustomInput(eventInfo, customInput, options) {
    // 如果成功率为null，随机生成
    const successRate = eventInfo.successRate ?? Math.floor(Math.random() * 60) + 20

    // 根据成功率随机判定
    const roll = Math.random() * 100
    const success = roll < successRate

    // 随机生成奖惩
    const rewards = generateRandomRewards()
    const affectionChange = success ? rewards.successAffection : rewards.failAffection
    const trustChange = success ? rewards.successTrust : rewards.failTrust
    const goldChange = success ? rewards.successGold : rewards.failGold

    return {
        success,
        eventName: eventInfo.name,
        optionText: customInput,
        message: success ? '成功！' : '失败...',
        affectionChange,
        trustChange,
        goldChange,
        roll: roll.toFixed(1),
        rate: successRate,
        isCustomInput: true
    }
}
