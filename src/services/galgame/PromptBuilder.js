/**
 * @fileoverview Galgame 提示词构建器
 * @module services/galgame/PromptBuilder
 */

import { AFFECTION_LEVELS, DEFAULT_SYSTEM_PROMPT, ENVIRONMENT_PROMPT } from './constants.js'

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
初始场景: ${env.scene || '日常'}`
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
    const level = getAffectionLevel(session.affection)

    const replacements = {
        '{environment_setting}': environmentSetting,
        '{character_setting}': character?.description || '根据环境设定扮演角色',
        '{affection_level}': level.name,
        '{affection_value}': session.affection.toString(),
        '{relationship_status}': getRelationshipStatus(session.affection),
        '{triggered_events}': triggeredEventsText,
        '{current_scene}': currentScene,
        '{current_task}': currentTask,
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
