/**
 * @fileoverview Galgame 提示词构建器
 * @module services/galgame/PromptBuilder
 */

import {
    AFFECTION_LEVELS,
    TRUST_LEVELS,
    DEFAULT_SYSTEM_PROMPT,
    ENVIRONMENT_PROMPT,
    ITEM_TYPE_LABELS
} from './constants.js'

/**
 * 获取好感度等级信息
 * @param {number} affection - 好感度值
 * @returns {Object} 等级信息 { min, max, name, emoji }
 */
export function getAffectionLevel(affection) {
    for (const level of AFFECTION_LEVELS) {
        if (affection >= level.min && affection <= level.max) {
            return level
        }
    }
    return AFFECTION_LEVELS[3] // 默认陌生
}

/**
 * 获取关系状态文本
 * @param {number} affection - 好感度值
 * @returns {string} 关系状态文本，如 "🙂 陌生"
 */
export function getRelationshipStatus(affection) {
    const level = getAffectionLevel(affection)
    return `${level.emoji} ${level.name}`
}

/**
 * 获取信任等级信息
 * @param {number} trust - 信任度值
 * @returns {Object} 等级信息 { min, max, name, emoji, color }
 */
export function getTrustLevel(trust) {
    for (const level of TRUST_LEVELS) {
        if (trust >= level.min && trust <= level.max) {
            return level
        }
    }
    return TRUST_LEVELS[3] // 默认观望
}

/**
 * 获取信任状态文本
 * @param {number} trust - 信任度值
 * @returns {string} 信任状态文本
 */
export function getTrustStatus(trust) {
    const level = getTrustLevel(trust)
    return `${level.emoji} ${level.name}`
}

/**
 * 构建已知信息文本
 * @param {Object} gameState - 游戏状态对象
 * @param {Array} triggeredEvents - 已触发的事件列表
 * @returns {string} 格式化的已知信息文本
 */
export function buildKnownInfo(gameState, triggeredEvents) {
    const info = []

    // 已发现的线索
    if (gameState.clues && gameState.clues.length > 0) {
        info.push('📝 线索: ' + gameState.clues.join('、'))
    }

    // 已认识的NPC
    if (gameState.knownNPCs && gameState.knownNPCs.length > 0) {
        info.push('👥 认识的人: ' + gameState.knownNPCs.join('、'))
    }

    // 已去过的地点
    if (gameState.visitedPlaces && gameState.visitedPlaces.length > 0) {
        info.push('📍 去过的地方: ' + gameState.visitedPlaces.join('、'))
    }

    // 已触发事件
    if (triggeredEvents.length > 0) {
        info.push('⭐ 经历的事件: ' + triggeredEvents.join('、'))
    }

    return info.length > 0 ? info.join('\n') : '（刚开始冒险，尚未发现任何信息）'
}

/**
 * 构建剧情进展文本
 * @param {Object} gameState - 游戏状态对象
 * @returns {string} 格式化的剧情进展文本
 */
export function buildStoryProgress(gameState) {
    if (gameState.plotHistory && gameState.plotHistory.length > 0) {
        return gameState.plotHistory.slice(-3).join('\n')
    }
    return '（故事刚刚开始）'
}

/**
 * 根据好感度/信任度阶段生成当前阶段目标提示
 * @param {number} affection - 好感度值
 * @param {number} trust - 信任度值
 * @param {Object} env - 环境设定
 * @returns {string} 阶段目标提示
 */
export function buildStageHint(affection, trust, env) {
    const hasUnknowns = env && Object.values(env).some(v => v === '???')

    if (affection <= 20 && trust <= 20) {
        return '与角色建立初步认识，了解基本信息' + (hasUnknowns ? '，尝试发现角色的未知面' : '')
    }
    if (affection <= 40) {
        return '加深与角色的熟悉度，参与日常活动'
    }
    if (affection <= 60) {
        const secretHint = trust < 40 ? '，提升信任度以发现更多秘密' : ''
        return '发展更深层的关系' + secretHint
    }
    if (affection <= 80) {
        return '感情进入关键阶段，重要选择将影响结局走向'
    }
    return '故事进入高潮，迎接最终结局'
}

/**
 * 根据 gameState 和环境设定生成可探索方向
 * @param {Object} gameState - 游戏状态
 * @param {Object} env - 环境设定
 * @param {Array} triggeredEvents - 已触发事件
 * @returns {string} 可探索方向文本
 */
export function buildExploreHints(gameState, env, triggeredEvents) {
    const hints = []

    // 检查 ??? 字段 - 暗示未知信息
    if (env) {
        if (env.identity === '???') hints.push('角色的真实身份还是谜')
        if (env.likes === '???') hints.push('还不了解角色的喜好')
        if (env.dislikes === '???') hints.push('不清楚角色讨厌什么')
        if (env.background === '???') hints.push('角色的过去还未知')
        if (env.secret === '???') hints.push('角色似乎隐藏着什么秘密')
        if (env.meetingReason === '???') hints.push('相遇的真正原因还不明确')
    }

    // 根据游戏进度添加提示
    if (!gameState.visitedPlaces || gameState.visitedPlaces.length <= 1) {
        hints.push('可以探索其他地点')
    }
    if (!gameState.knownNPCs || gameState.knownNPCs.length === 0) {
        hints.push('还没有认识其他角色')
    }
    if (gameState.currentTask) {
        hints.push(`当前任务: ${gameState.currentTask}`)
    }

    if (hints.length === 0) {
        hints.push('继续与角色互动，推进剧情')
    }

    return hints.slice(0, 3).join('；')
}

/**
 * 构建背包展示文本（供 system prompt 使用）
 * 按类型分类展示，AI 需要知道类型来判断剧情分支
 * @param {Array} items - 物品数组 [{ name, type, description }]
 * @returns {string} 背包文本
 */
export function buildInventoryText(items) {
    if (!items || items.length === 0) {
        return '（空）'
    }

    // 按类型分组
    const grouped = {}
    for (const item of items) {
        const type = item.type || 'consumable'
        if (!grouped[type]) grouped[type] = []
        grouped[type].push(item)
    }

    // 按类型优先级排列: key > clue > gift > consumable
    const typeOrder = ['key', 'clue', 'gift', 'consumable']
    const lines = []

    for (const type of typeOrder) {
        const typeItems = grouped[type]
        if (!typeItems || typeItems.length === 0) continue

        const label = ITEM_TYPE_LABELS[type] || type
        const names = typeItems.map(i => {
            let desc = i.name
            if (i.description) desc += `(${i.description})`
            return desc
        })
        lines.push(`${label}: ${names.join('、')}`)
    }

    // 处理未知类型
    for (const type of Object.keys(grouped)) {
        if (!typeOrder.includes(type)) {
            const typeItems = grouped[type]
            const names = typeItems.map(i => i.name)
            lines.push(`其他: ${names.join('、')}`)
        }
    }

    return lines.length > 0 ? lines.join('\n') : '（空）'
}

/**
 * 构建系统提示词
 * @param {Object} options - 构建选项
 * @param {Object} options.character - 角色配置
 * @param {Object} options.session - 会话数据
 * @param {Object} options.settings - 会话设置（包含environment和gameState）
 * @param {Array} options.triggeredEvents - 已触发事件列表
 * @param {string} [options.historySummary=''] - 历史对话摘要
 * @returns {string} 完整的系统提示词
 */
export function buildSystemPrompt(options) {
    const { character, session, settings, triggeredEvents, historySummary = '' } = options

    const triggeredEventsText = triggeredEvents.length > 0 ? triggeredEvents.join('、') : '暂无'

    const env = settings?.environment
    const gameState = settings?.gameState || {}

    // 构建环境设定文本
    let environmentSetting = ''
    if (env && env.name) {
        // 检查玩家是否已发现秘密
        const secretRevealed = gameState.revealedSecrets?.includes('main_secret')

        environmentSetting = `角色名: ${env.name}
世界观: ${env.world || '现代'}
身份: ${env.identity || '普通人'}
性格: ${env.personality || '温和友善'}
喜好: ${env.likes || '???'}
厌恶: ${env.dislikes || '???'}
背景故事: ${env.background || '???'}
角色秘密: ${secretRevealed ? env.secret : '???(玩家尚未发现)'}
相遇原因: ${env.meetingReason || '偶然相遇'}
初始场景: ${env.scene || '日常'}
前情提要: ${env.summary || '故事刚刚开始'}`
    } else {
        environmentSetting = '（等待初始化）'
    }

    // 构建当前场景
    const currentScene = gameState.currentScene
        ? `${gameState.currentScene.name}${gameState.currentScene.description ? ' - ' + gameState.currentScene.description : ''}`
        : env?.scene || '未知'

    // 构建当前任务
    const currentTask = gameState.currentTask || '无'

    // 构建已知信息
    const knownInfo = buildKnownInfo(gameState, triggeredEvents)

    // 构建剧情进展
    const storyProgress = buildStoryProgress(gameState)

    // 用户自定义或默认模板
    let userPrompt = character?.system_prompt || DEFAULT_SYSTEM_PROMPT
    const affectionLevel = getAffectionLevel(session.affection)
    const trustLevel = getTrustLevel(session.trust || 10)
    const gold = session.gold || 100
    let items = []
    try {
        items = JSON.parse(session.items || '[]')
    } catch {
        items = []
    }
    const inventoryText = buildInventoryText(items)

    // 构建阶段目标和探索方向
    const stageHint = buildStageHint(session.affection, session.trust || 10, env)
    const exploreHints = buildExploreHints(gameState, env, triggeredEvents)

    const replacements = {
        '{environment_setting}': environmentSetting,
        '{character_setting}': character?.description || '根据环境设定扮演角色',
        '{affection_level}': affectionLevel.name,
        '{affection_value}': session.affection.toString(),
        '{trust_level}': trustLevel.name,
        '{trust_value}': (session.trust || 10).toString(),
        '{gold_value}': gold.toString(),
        '{inventory}': inventoryText,
        '{items}': items.map(i => i.name).join('、') || '无', // backward compat
        '{relationship_status}': getRelationshipStatus(session.affection),
        '{trust_status}': getTrustStatus(session.trust || 10),
        '{triggered_events}': triggeredEventsText,
        '{current_scene}': currentScene,
        '{current_task}': currentTask,
        '{stage_hint}': stageHint,
        '{explore_hints}': exploreHints,
        '{known_info}': knownInfo,
        '{story_progress}': storyProgress,
        '{history_summary}': historySummary || '（暂无历史对话）'
    }

    for (const [key, value] of Object.entries(replacements)) {
        userPrompt = userPrompt.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value)
    }

    // 强制追加环境提示词（防止用户自定义导致问题）
    return userPrompt + '\n\n' + ENVIRONMENT_PROMPT
}

/**
 * 构建开场提示词
 * @param {Object} env - 环境设定
 * @returns {string} 开场提示词
 */
export function buildOpeningPrompt(env) {
    return `你是${env.name}，一个${env.world}世界观中的${env.identity}。

【你的详细设定】
- 性格: ${env.personality}
- 喜好: ${env.likes}
- 厌恶: ${env.dislikes}
- 背景: ${env.background}
- 秘密: ${env.secret}（这是你的秘密，不要直接告诉玩家）

【当前情境】
场景: ${env.scene}
相遇原因: ${env.meetingReason}

【任务】
请以${env.name}的身份，生成一段丰富的开场。要求：

1. 首先用【场景描述】描述当前的环境氛围（2-3句话）
2. 然后用【角色出场】描述你（角色）此刻在做什么（1-2句话）
3. 接着用【相遇时刻】描述玩家是如何出现的，你注意到了他/她（1-2句话）
4. 最后用【开场对话】给出你对玩家说的第一句话

请保持角色性格一致，营造出${env.world}的氛围感。
使用标记格式输出：
[当前场景:场景名称|详细场景描述]
然后直接输出上述4个部分的内容（不需要标记部分名称，自然衔接即可）`
}
