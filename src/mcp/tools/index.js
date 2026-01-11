/**
 * 内置工具加载器
 * 按类别组织工具，方便管理和扩展
 */

import { basicTools } from './basic.js'
import { userTools } from './user.js'
import { groupTools } from './group.js'
import { messageTools, forwardDataTools } from './message.js'
import { adminTools } from './admin.js'
import { groupStatsTools } from './groupStats.js'
import { fileTools } from './file.js'
import { webTools } from './web.js'
import { memoryTools } from './memory.js'
import { contextTools } from './context.js'
import { mediaTools } from './media.js'
import { searchTools } from './search.js'
import { utilsTools } from './utils.js'
import { botTools } from './bot.js'
import { voiceTools } from './voice.js'
import { extraTools } from './extra.js'
import { shellTools } from './shell.js'

/**
 * 工具类别配置
 * 用于管理页面显示和工具开关
 */
export const toolCategories = {
    basic: {
        name: '基础工具',
        description: '时间获取、随机数等基础功能',
        icon: 'Clock',
        tools: basicTools
    },
    user: {
        name: '用户信息',
        description: '获取用户信息、好友列表等',
        icon: 'User',
        tools: userTools
    },
    group: {
        name: '群组信息',
        description: '获取群信息、成员列表等',
        icon: 'Users',
        tools: groupTools
    },
    message: {
        name: '消息操作',
        description: '发送消息、@用户、获取聊天记录、转发消息解析等',
        icon: 'MessageSquare',
        tools: [...messageTools, ...forwardDataTools]
    },
    admin: {
        name: '群管理',
        description: '禁言、踢人、设置群名片等管理功能',
        icon: 'Shield',
        tools: adminTools
    },
    groupStats: {
        name: '群统计',
        description: '群星级、龙王、发言榜、幸运字符、不活跃成员等',
        icon: 'BarChart',
        tools: groupStatsTools
    },
    file: {
        name: '文件操作',
        description: '群文件上传、下载、管理等',
        icon: 'FolderOpen',
        tools: fileTools
    },
    media: {
        name: '媒体处理',
        description: '图片解析、语音处理、二维码生成等',
        icon: 'Image',
        tools: mediaTools
    },
    web: {
        name: '网页访问',
        description: '访问网页、获取内容等',
        icon: 'Globe',
        tools: webTools
    },
    search: {
        name: '搜索工具',
        description: '网页搜索、Wiki查询、翻译等',
        icon: 'Search',
        tools: searchTools
    },
    utils: {
        name: '实用工具',
        description: '计算、编码转换、时间处理等',
        icon: 'Wrench',
        tools: utilsTools
    },
    memory: {
        name: '记忆管理',
        description: '用户记忆的增删改查',
        icon: 'Brain',
        tools: memoryTools
    },
    context: {
        name: '上下文管理',
        description: '对话上下文、群聊上下文等',
        icon: 'History',
        tools: contextTools
    },
    bot: {
        name: 'Bot信息',
        description: '获取机器人自身信息、状态、好友列表等',
        icon: 'Bot',
        tools: botTools
    },
    voice: {
        name: '语音/声聊',
        description: 'AI语音对话、TTS语音合成、语音识别等',
        icon: 'Mic',
        tools: voiceTools
    },
    extra: {
        name: '扩展工具',
        description: '天气查询、一言、骰子、倒计时、提醒、插画等',
        icon: 'Sparkles',
        tools: extraTools
    },
    shell: {
        name: '系统命令',
        description: '执行Shell命令、获取系统信息、环境变量等（危险）',
        icon: 'Terminal',
        tools: shellTools,
        dangerous: true
    }
}

/**
 * 获取所有工具
 * @param {Object} options - 选项
 * @param {string[]} options.enabledCategories - 启用的类别
 * @param {string[]} options.disabledTools - 禁用的工具名称
 * @returns {Array} 工具数组
 */
export function getAllTools(options = {}) {
    const { enabledCategories, disabledTools = [] } = options
    const allTools = []

    for (const [category, config] of Object.entries(toolCategories)) {
        if (enabledCategories && !enabledCategories.includes(category)) {
            continue
        }

        // 过滤禁用的工具
        const tools = config.tools.filter(tool => !disabledTools.includes(tool.name))
        allTools.push(...tools)
    }

    return allTools
}

/**
 * 获取工具类别信息（用于管理页面）
 * @returns {Array} 类别信息数组
 */
export function getCategoryInfo() {
    return Object.entries(toolCategories).map(([key, config]) => ({
        key,
        name: config.name,
        description: config.description,
        icon: config.icon,
        toolCount: config.tools.length,
        tools: config.tools.map(t => ({ name: t.name, description: t.description }))
    }))
}

/**
 * 按名称获取工具
 * @param {string} name - 工具名称
 * @returns {Object|null} 工具定义
 */
export function getToolByName(name) {
    for (const config of Object.values(toolCategories)) {
        const tool = config.tools.find(t => t.name === name)
        if (tool) return tool
    }
    return null
}
