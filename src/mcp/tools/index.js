/**
 * 内置工具加载器
 * 按类别组织工具，方便管理和扩展
 * 支持热重载：使用动态导入 + 时间戳避免缓存
 */

// 工具模块文件列表
const toolModules = {
    basic: { file: './basic.js', export: 'basicTools' },
    user: { file: './user.js', export: 'userTools' },
    group: { file: './group.js', export: 'groupTools' },
    message: { file: './message.js', export: ['messageTools', 'forwardDataTools'] },
    admin: { file: './admin.js', export: 'adminTools' },
    groupStats: { file: './groupStats.js', export: 'groupStatsTools' },
    file: { file: './file.js', export: 'fileTools' },
    web: { file: './web.js', export: 'webTools' },
    memory: { file: './memory.js', export: 'memoryTools' },
    context: { file: './context.js', export: 'contextTools' },
    media: { file: './media.js', export: 'mediaTools' },
    search: { file: './search.js', export: 'searchTools' },
    utils: { file: './utils.js', export: 'utilsTools' },
    bot: { file: './bot.js', export: 'botTools' },
    voice: { file: './voice.js', export: 'voiceTools' },
    extra: { file: './extra.js', export: 'extraTools' },
    shell: { file: './shell.js', export: 'shellTools' },
    schedule: { file: './schedule.js', export: 'scheduleTools' },
    bltools: { file: './bltools.js', export: 'bltoolsTools' },
    reminder: { file: './reminder.js', export: 'reminderTools' }
}

// 类别元信息
const categoryMeta = {
    basic: { name: '基础工具', description: '时间获取、随机数等基础功能', icon: 'Clock' },
    user: { name: '用户信息', description: '获取用户信息、好友列表等', icon: 'User' },
    group: { name: '群组信息', description: '获取群信息、成员列表等', icon: 'Users' },
    message: { name: '消息操作', description: '发送消息、@用户、获取聊天记录、转发消息解析等', icon: 'MessageSquare' },
    admin: { name: '群管理', description: '禁言、踢人、设置群名片等管理功能', icon: 'Shield' },
    groupStats: { name: '群统计', description: '群星级、龙王、发言榜、幸运字符、不活跃成员等', icon: 'BarChart' },
    file: { name: '文件操作', description: '群文件上传下载、本地文件读写、目录管理、URL下载等', icon: 'FolderOpen' },
    media: { name: '媒体处理', description: '图片解析、语音处理、二维码生成等', icon: 'Image' },
    web: { name: '网页访问', description: '访问网页、获取内容等', icon: 'Globe' },
    search: { name: '搜索工具', description: '网页搜索、Wiki查询、翻译等', icon: 'Search' },
    utils: { name: '实用工具', description: '计算、编码转换、时间处理等', icon: 'Wrench' },
    memory: { name: '记忆管理', description: '用户记忆的增删改查', icon: 'Brain' },
    context: { name: '上下文管理', description: '对话上下文、群聊上下文等', icon: 'History' },
    bot: { name: 'Bot信息', description: '获取机器人自身信息、状态、好友列表等', icon: 'Bot' },
    voice: { name: '语音/声聊', description: 'AI语音对话、TTS语音合成、语音识别等', icon: 'Mic' },
    extra: { name: '扩展工具', description: '天气查询、一言、骰子、倒计时、提醒、插画等', icon: 'Sparkles' },
    shell: {
        name: '系统命令',
        description: '执行Shell命令、获取系统信息、环境变量等（危险）',
        icon: 'Terminal',
        dangerous: true
    },
    schedule: {
        name: '定时任务',
        description: '创建、管理定时任务，支持周期执行、@用户、触发AI对话等',
        icon: 'Clock'
    },
    bltools: {
        name: '扩展工具',
        description:
            'QQ音乐、表情包、Bing图片、壁纸、B站视频搜索/总结、GitHub仓库、AI图片编辑、视频分析、AI思维导图、表情回应等',
        icon: 'Sparkles'
    },
    reminder: {
        name: '定时提醒',
        description: '设置定时提醒，支持相对时间、绝对时间、每天/每周重复',
        icon: 'Bell'
    }
}

// 缓存加载的工具类别
let toolCategories = null
let lastLoadTime = 0

/**
 * 动态加载工具模块
 * @param {boolean} forceReload - 强制重新加载
 */
async function loadToolModules(forceReload = false) {
    const now = Date.now()
    if (toolCategories && !forceReload && now - lastLoadTime < 1000) {
        return toolCategories
    }

    toolCategories = {}
    const timestamp = now // 用于缓存破坏

    for (const [category, moduleInfo] of Object.entries(toolModules)) {
        try {
            // 动态导入，添加时间戳避免缓存
            const module = await import(`${moduleInfo.file}?t=${timestamp}`)

            let tools = []
            if (Array.isArray(moduleInfo.export)) {
                // 多个导出合并
                for (const exp of moduleInfo.export) {
                    if (module[exp]) {
                        tools = tools.concat(module[exp])
                    }
                }
            } else {
                tools = module[moduleInfo.export] || []
            }

            const meta = categoryMeta[category] || {}
            toolCategories[category] = {
                name: meta.name || category,
                description: meta.description || '',
                icon: meta.icon || 'Tool',
                tools,
                ...(meta.dangerous && { dangerous: true })
            }
        } catch (err) {
            console.warn(`[BuiltinMCP] 加载工具模块 ${category} 失败:`, err.message)
            toolCategories[category] = {
                ...categoryMeta[category],
                tools: []
            }
        }
    }

    lastLoadTime = now
    return toolCategories
}
export { toolCategories }

/**
 * 获取所有工具
 * @param {Object} options - 选项
 * @param {string[]} options.enabledCategories - 启用的类别
 * @param {string[]} options.disabledTools - 禁用的工具名称
 * @param {boolean} options.forceReload - 强制重新加载模块
 * @returns {Promise<Array>} 工具数组
 */
export async function getAllTools(options = {}) {
    const { enabledCategories, disabledTools = [], forceReload = false } = options
    const categories = await loadToolModules(forceReload)
    const allTools = []

    for (const [category, config] of Object.entries(categories)) {
        if (enabledCategories && !enabledCategories.includes(category)) {
            continue
        }
        const tools = (config.tools || []).filter(tool => !disabledTools.includes(tool.name))
        allTools.push(...tools)
    }

    return allTools
}

/**
 * 获取工具类别信息（用于管理页面）
 * @param {boolean} forceReload - 强制重新加载
 * @returns {Promise<Array>} 类别信息数组
 */
export async function getCategoryInfo(forceReload = false) {
    const categories = await loadToolModules(forceReload)
    return Object.entries(categories).map(([key, config]) => ({
        key,
        name: config.name,
        description: config.description,
        icon: config.icon,
        toolCount: (config.tools || []).length,
        tools: (config.tools || []).map(t => ({ name: t.name, description: t.description }))
    }))
}

/**
 * 按名称获取工具
 * @param {string} name - 工具名称
 * @param {boolean} forceReload - 强制重新加载
 * @returns {Promise<Object|null>} 工具定义
 */
export async function getToolByName(name, forceReload = false) {
    const categories = await loadToolModules(forceReload)
    for (const config of Object.values(categories)) {
        const tool = (config.tools || []).find(t => t.name === name)
        if (tool) return tool
    }
    return null
}

/**
 * 强制重新加载所有工具模块
 * @returns {Promise<Object>} 加载后的工具类别
 */
export async function reloadToolModules() {
    return await loadToolModules(true)
}

export { loadToolModules }
