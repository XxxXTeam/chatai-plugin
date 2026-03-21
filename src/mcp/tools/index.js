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
    schedule: { file: './nlSchedule.js', export: 'nlScheduleTools' },
    bltools: { file: './bltools.js', export: 'bltoolsTools' },
    reminder: { file: './reminder.js', export: 'reminderTools' },
    imageGen: { file: './imageGen.js', export: 'imageGenTools' },
    qzone: { file: './qzone.js', export: 'qzoneTools' }
}

// 类别元信息
const categoryMeta = {
    basic: {
        name: '基础工具',
        description: '获取当前时间日期、农历、节日等。用户问"几点了""什么时候"时调用',
        icon: 'Clock'
    },
    user: {
        name: '用户信息',
        description: '查询QQ用户资料、头像、好友关系。用户问"他是谁""查一下这个人"时调用',
        icon: 'User'
    },
    group: {
        name: '群组信息',
        description: '获取群成员列表、群资料、群公告。用户问"群里有多少人""群成员"时调用',
        icon: 'Users'
    },
    message: {
        name: '消息操作',
        description: '发送消息、@用户、获取聊天记录、合并转发、撤回。用户需要发消息或查聊天记录时调用',
        icon: 'MessageSquare'
    },
    admin: { name: '群管理', description: '禁言、踢人、设群名片、群公告。用户请求管理操作时调用', icon: 'Shield' },
    groupStats: {
        name: '群统计',
        description: '群活跃数据、发言排行、龙王、打卡。用户问"谁发言最多""群活跃度"时调用',
        icon: 'BarChart'
    },
    file: { name: '文件操作', description: '群文件上传下载、本地文件读写。用户需要文件操作时调用', icon: 'FolderOpen' },
    media: {
        name: '媒体处理',
        description: '发送图片/视频/音乐/表情、解析图片、生成二维码。用户需要发送媒体内容时调用',
        icon: 'Image'
    },
    web: { name: '网页访问', description: '访问URL获取网页内容。用户提供链接或需要获取网页信息时调用', icon: 'Globe' },
    search: {
        name: '搜索工具',
        description: '搜索引擎、百科、翻译、天气、热搜、油价。用户问事实性问题或需要查询最新信息时调用',
        icon: 'Search'
    },
    utils: {
        name: '实用工具',
        description: '数学计算、编码转换、正则匹配、密码生成。用户需要计算或文本处理时调用',
        icon: 'Wrench'
    },
    memory: { name: '记忆管理', description: '保存、查询、搜索用户记忆。需要记住或回忆用户信息时调用', icon: 'Brain' },
    context: {
        name: '上下文管理',
        description: '获取对话上下文、被引用消息、@列表。需要了解对话环境时调用',
        icon: 'History'
    },
    bot: { name: 'Bot信息', description: '获取机器人自身信息和运行状态。用户问"你是谁""你的QQ号"时调用', icon: 'Bot' },
    voice: { name: '语音/声聊', description: 'AI语音对话、TTS语音合成、语音识别。用户需要语音功能时调用', icon: 'Mic' },
    extra: {
        name: '扩展工具',
        description: '天气查询、一言、骰子、倒计时、提醒、动漫插画。用户问天气或需要趣味功能时调用',
        icon: 'Sparkles'
    },
    shell: {
        name: '系统命令',
        description: '执行Shell命令、获取系统信息（危险，仅限主人）',
        icon: 'Terminal',
        dangerous: true
    },
    schedule: {
        name: '定时任务',
        description: '自然语言定时任务。用户说"X分钟后""明天提醒我"时调用',
        icon: 'Clock'
    },
    bltools: {
        name: '扩展工具',
        description:
            'QQ音乐、表情包搜索、Bing图片、壁纸、B站视频搜索/总结、GitHub、AI图片编辑、视频分析、思维导图。用户要听歌、找图、看视频时调用',
        icon: 'Sparkles'
    },
    reminder: {
        name: '定时提醒',
        description: '设置定时提醒，支持相对/绝对时间和重复。用户说"提醒我""别忘了"时调用',
        icon: 'Bell'
    },
    imageGen: {
        name: '绘图服务',
        description: 'AI绘图生成。用户说"画""生成图片""文生图"时调用',
        icon: 'Palette'
    },
    qzone: {
        name: 'QQ空间/说说',
        description: '发布/获取/点赞说说、个性签名、戳一戳。用户需要操作QQ空间时调用',
        icon: 'Star'
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
            logger.warn(`[BuiltinMCP] 加载工具模块 ${category} 失败:`, err.message)
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
