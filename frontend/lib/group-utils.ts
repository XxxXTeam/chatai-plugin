import { GroupConfig, GroupFormState, IndependentChannel } from './types'

/**
 * 将三态开关值（inherit/on/off）转换为 API 格式
 */
function toApiSwitch(value: 'inherit' | 'on' | 'off'): boolean | string {
    if (value === 'inherit') return 'inherit'
    return value === 'on'
}

/**
 * 将 API 格式转换为三态开关值
 */
function fromApiSwitch(value: boolean | string | undefined, defaultVal: 'inherit' | 'on' | 'off' = 'inherit'): 'inherit' | 'on' | 'off' {
    if (value === undefined || value === null || value === 'inherit') return defaultVal
    if (typeof value === 'boolean') return value ? 'on' : 'off'
    if (value === 'on' || value === 'off') return value
    return defaultVal
}

/**
 * 将数字或 inherit 字符串转换为表单格式
 */
function fromApiNumber(value: number | string | undefined, defaultVal: number | 'inherit' = 'inherit'): number | 'inherit' {
    if (value === undefined || value === null || value === 'inherit') return defaultVal
    if (typeof value === 'number') return value
    const parsed = parseFloat(value)
    return isNaN(parsed) ? defaultVal : parsed
}

/**
 * 将表单数字值转换为 API 格式
 */
function toApiNumber(value: number | 'inherit'): number | string | undefined {
    if (value === 'inherit') return 'inherit'
    return value
}

/**
 * 获取默认表单值
 */
export function getDefaultForm(): GroupFormState {
    return {
        groupId: '',
        groupName: '',
        enabled: true,
        presetId: 'default',
        systemPrompt: '',
        triggerMode: 'all',
        customPrefix: '#ai',

        // 模型配置
        chatModel: '',
        summaryModel: '',
        bymModel: '',
        imageGenModel: '',

        // 功能开关
        toolsEnabled: 'inherit',
        imageGenEnabled: 'inherit',
        summaryEnabled: 'inherit',
        eventEnabled: 'inherit',

        // 伪人配置
        bymEnabled: 'inherit',
        bymPresetId: '__default__',
        bymPrompt: '',
        bymProbability: 'inherit',
        bymTemperature: 'inherit',
        bymMaxTokens: 'inherit',
        bymReplyLength: 'short',
        bymUseEmoji: true,

        // 主动发言
        proactiveChatEnabled: 'inherit',
        proactiveChatProbability: 'inherit',
        proactiveChatCooldown: 'inherit',
        proactiveChatMaxDaily: 'inherit',
        proactiveChatMinMessages: 5,
        proactiveChatTimeStart: 8,
        proactiveChatTimeEnd: 23,

        // 事件配置
        welcomeEnabled: 'inherit',
        welcomeMessage: '',
        welcomePrompt: '',
        welcomeProbability: 'inherit',
        goodbyeEnabled: 'inherit',
        goodbyePrompt: '',
        goodbyeProbability: 'inherit',
        pokeEnabled: 'inherit',
        pokeBack: false,
        pokeProbability: 'inherit',

        // 其他事件
        recallEnabled: 'inherit',
        recallProbability: 'inherit',
        banEnabled: 'inherit',
        banProbability: 'inherit',
        luckyKingEnabled: 'inherit',
        luckyKingProbability: 'inherit',
        honorEnabled: 'inherit',
        honorProbability: 'inherit',
        essenceEnabled: 'inherit',
        essenceProbability: 'inherit',
        adminEnabled: 'inherit',
        adminProbability: 'inherit',

        // 表情包小偷
        emojiThiefEnabled: 'inherit',
        emojiThiefSeparateFolder: false,
        emojiThiefMaxCount: 100,
        emojiThiefStealRate: 0.1,
        emojiThiefTriggerRate: 0.05,
        emojiThiefTriggerMode: 'random',

        // 聊天配置
        chatEnabled: true,
        chatContextLength: 20,
        chatStreamReply: true,
        chatQuoteReply: true,
        chatShowThinking: true,

        // 黑白名单
        listMode: 'none',
        blacklist: [],
        whitelist: [],

        // 定时总结推送
        summaryPushEnabled: false,
        summaryPushIntervalType: 'day',
        summaryPushIntervalValue: 1,
        summaryPushHour: 22,
        summaryPushMessageCount: 100,

        // 绘图配置
        text2imgModel: '',
        img2imgModel: '',
        imageGenSize: '1024x1024',
        imageGenQuality: 'standard',
        imageGenDailyLimit: 10,

        // 群独立渠道
        independentChannelEnabled: false,
        independentBaseUrl: '',
        independentApiKey: '',
        independentAdapterType: 'openai',
        forbidGlobalModel: false,
        independentChannels: [],

        // 使用限制
        dailyGroupLimit: 0,
        dailyUserLimit: 0,
        usageLimitMessage: '',

        // 知识库
        knowledgeIds: []
    }
}

/**
 * 将 API 返回的配置转换为表单状态
 */
export function apiToForm(config: GroupConfig): GroupFormState {
    const defaults = getDefaultForm()
    
    const form: GroupFormState = {
        groupId: config.groupId || defaults.groupId,
        groupName: config.groupName || defaults.groupName,
        enabled: config.enabled ?? defaults.enabled,
        presetId: config.presetId || defaults.presetId,
        systemPrompt: config.systemPrompt || defaults.systemPrompt,
        triggerMode: config.triggerMode || defaults.triggerMode,
        customPrefix: config.customPrefix || defaults.customPrefix,

        // 模型配置
        chatModel: config.models?.chat || defaults.chatModel,
        summaryModel: config.models?.summary || defaults.summaryModel,
        bymModel: config.models?.bym || config.bym?.modelId || defaults.bymModel,
        imageGenModel: config.models?.image || config.imageGen?.modelId || defaults.imageGenModel,

        // 功能开关
        toolsEnabled: fromApiSwitch(config.toolsEnabled),
        imageGenEnabled: fromApiSwitch(config.imageGenEnabled),
        summaryEnabled: fromApiSwitch(config.summaryEnabled),
        eventEnabled: fromApiSwitch(config.eventHandler),

        // 伪人配置
        bymEnabled: fromApiSwitch(config.bym?.enabled),
        bymPresetId: config.bym?.presetId || defaults.bymPresetId,
        bymPrompt: config.bym?.prompt || defaults.bymPrompt,
        bymProbability: fromApiNumber(config.bym?.probability),
        bymTemperature: fromApiNumber(config.bym?.temperature),
        bymMaxTokens: fromApiNumber(config.bym?.maxTokens),
        bymReplyLength: config.bym?.style?.replyLength || defaults.bymReplyLength,
        bymUseEmoji: config.bym?.style?.useEmoji ?? defaults.bymUseEmoji,

        // 主动发言
        proactiveChatEnabled: fromApiSwitch(config.bym?.proactive?.enabled),
        proactiveChatProbability: fromApiNumber(config.bym?.proactive?.probability),
        proactiveChatCooldown: fromApiNumber(config.bym?.proactive?.cooldown),
        proactiveChatMaxDaily: fromApiNumber(config.bym?.proactive?.maxDaily),
        proactiveChatMinMessages: config.bym?.proactive?.minMessages ?? defaults.proactiveChatMinMessages,
        proactiveChatTimeStart: config.bym?.proactive?.timeRange?.start ?? defaults.proactiveChatTimeStart,
        proactiveChatTimeEnd: config.bym?.proactive?.timeRange?.end ?? defaults.proactiveChatTimeEnd,

        // 事件配置
        welcomeEnabled: fromApiSwitch(config.events?.welcome?.enabled),
        welcomeMessage: config.events?.welcome?.message || defaults.welcomeMessage,
        welcomePrompt: config.events?.welcome?.prompt || defaults.welcomePrompt,
        welcomeProbability: fromApiNumber(config.events?.welcome?.probability),
        goodbyeEnabled: fromApiSwitch(config.events?.goodbye?.enabled),
        goodbyePrompt: config.events?.goodbye?.prompt || defaults.goodbyePrompt,
        goodbyeProbability: fromApiNumber(config.events?.goodbye?.probability),
        pokeEnabled: fromApiSwitch(config.events?.poke?.enabled),
        pokeBack: config.events?.poke?.pokeBack ?? defaults.pokeBack,
        pokeProbability: fromApiNumber(config.events?.poke?.probability),

        // 其他事件
        recallEnabled: fromApiSwitch(config.events?.recall?.enabled),
        recallProbability: fromApiNumber(config.events?.recall?.probability),
        banEnabled: fromApiSwitch(config.events?.ban?.enabled),
        banProbability: fromApiNumber(config.events?.ban?.probability),
        luckyKingEnabled: fromApiSwitch(config.events?.luckyKing?.enabled),
        luckyKingProbability: fromApiNumber(config.events?.luckyKing?.probability),
        honorEnabled: fromApiSwitch(config.events?.honor?.enabled),
        honorProbability: fromApiNumber(config.events?.honor?.probability),
        essenceEnabled: fromApiSwitch(config.events?.essence?.enabled),
        essenceProbability: fromApiNumber(config.events?.essence?.probability),
        adminEnabled: fromApiSwitch(config.events?.admin?.enabled),
        adminProbability: fromApiNumber(config.events?.admin?.probability),

        // 表情包小偷
        emojiThiefEnabled: fromApiSwitch(config.emojiThief?.enabled),
        emojiThiefSeparateFolder: config.emojiThief?.independent ?? defaults.emojiThiefSeparateFolder,
        emojiThiefMaxCount: config.emojiThief?.maxCount ?? defaults.emojiThiefMaxCount,
        emojiThiefStealRate: config.emojiThief?.probability ?? defaults.emojiThiefStealRate,
        emojiThiefTriggerRate: config.emojiThief?.triggerRate ?? defaults.emojiThiefTriggerRate,
        emojiThiefTriggerMode: config.emojiThief?.triggerMode || defaults.emojiThiefTriggerMode,

        // 聊天配置
        chatEnabled: config.chat?.enabled ?? defaults.chatEnabled,
        chatContextLength: config.chat?.contextLength ?? defaults.chatContextLength,
        chatStreamReply: config.chat?.streamReply ?? defaults.chatStreamReply,
        chatQuoteReply: config.chat?.quoteReply ?? defaults.chatQuoteReply,
        chatShowThinking: config.chat?.showThinking ?? defaults.chatShowThinking,

        // 黑白名单
        listMode: config.listMode || defaults.listMode,
        blacklist: config.blacklist || defaults.blacklist,
        whitelist: config.whitelist || defaults.whitelist,

        // 定时总结推送
        summaryPushEnabled: config.summary?.push?.enabled ?? defaults.summaryPushEnabled,
        summaryPushIntervalType: config.summary?.push?.intervalType || defaults.summaryPushIntervalType,
        summaryPushIntervalValue: config.summary?.push?.intervalValue ?? defaults.summaryPushIntervalValue,
        summaryPushHour: config.summary?.push?.pushHour ?? defaults.summaryPushHour,
        summaryPushMessageCount: config.summary?.push?.messageCount ?? defaults.summaryPushMessageCount,

        // 绘图配置
        text2imgModel: config.imageGen?.text2imgModel || defaults.text2imgModel,
        img2imgModel: config.imageGen?.img2imgModel || defaults.img2imgModel,
        imageGenSize: config.imageGen?.size || defaults.imageGenSize,
        imageGenQuality: config.imageGen?.quality || defaults.imageGenQuality,
        imageGenDailyLimit: config.imageGen?.maxDailyLimit ?? defaults.imageGenDailyLimit,

        // 群独立渠道
        independentChannelEnabled: config.independentChannel?.hasChannel ?? defaults.independentChannelEnabled,
        independentBaseUrl: config.independentChannel?.baseUrl || defaults.independentBaseUrl,
        independentApiKey: config.independentChannel?.apiKey || defaults.independentApiKey,
        independentAdapterType: config.independentChannel?.adapterType || defaults.independentAdapterType,
        forbidGlobalModel: config.independentChannel?.forbidGlobal ?? defaults.forbidGlobalModel,
        independentChannels: config.independentChannel?.channels || defaults.independentChannels,

        // 使用限制
        dailyGroupLimit: config.usageLimit?.dailyGroupLimit ?? defaults.dailyGroupLimit,
        dailyUserLimit: config.usageLimit?.dailyUserLimit ?? defaults.dailyUserLimit,
        usageLimitMessage: config.usageLimit?.limitMessage || defaults.usageLimitMessage,

        // 知识库
        knowledgeIds: config.knowledgeIds || defaults.knowledgeIds
    }

    return form
}

/**
 * 将表单状态转换为 API 格式
 */
export function formToApi(form: GroupFormState): Partial<GroupConfig> {
    const config: Partial<GroupConfig> = {
        groupId: form.groupId,
        groupName: form.groupName,
        enabled: form.enabled,
        presetId: form.presetId,
        systemPrompt: form.systemPrompt,
        triggerMode: form.triggerMode,
        customPrefix: form.customPrefix,

        // 功能开关
        toolsEnabled: toApiSwitch(form.toolsEnabled),
        imageGenEnabled: toApiSwitch(form.imageGenEnabled),
        summaryEnabled: toApiSwitch(form.summaryEnabled),
        eventHandler: toApiSwitch(form.eventEnabled),

        // 模型配置
        models: {
            chat: form.chatModel,
            tools: '',
            dispatch: '',
            vision: '',
            image: form.imageGenModel,
            search: '',
            bym: form.bymModel,
            summary: form.summaryModel,
            profile: ''
        },

        // 伪人配置
        bym: {
            enabled: toApiSwitch(form.bymEnabled),
            presetId: form.bymPresetId,
            prompt: form.bymPrompt,
            probability: toApiNumber(form.bymProbability),
            modelId: form.bymModel,
            temperature: toApiNumber(form.bymTemperature),
            maxTokens: toApiNumber(form.bymMaxTokens),
            proactive: {
                enabled: form.proactiveChatEnabled === 'on',
                probability: form.proactiveChatProbability === 'inherit' ? undefined : form.proactiveChatProbability,
                cooldown: form.proactiveChatCooldown === 'inherit' ? undefined : form.proactiveChatCooldown,
                maxDaily: form.proactiveChatMaxDaily === 'inherit' ? undefined : form.proactiveChatMaxDaily,
                minMessages: form.proactiveChatMinMessages,
                timeRange: {
                    start: form.proactiveChatTimeStart,
                    end: form.proactiveChatTimeEnd
                }
            },
            style: {
                replyLength: form.bymReplyLength,
                useEmoji: form.bymUseEmoji
            }
        },

        // 聊天配置
        chat: {
            enabled: form.chatEnabled,
            contextLength: form.chatContextLength,
            streamReply: form.chatStreamReply,
            quoteReply: form.chatQuoteReply,
            showThinking: form.chatShowThinking
        },

        // 事件配置
        events: {
            enabled: form.eventEnabled !== 'off',
            welcome: {
                enabled: form.welcomeEnabled === 'on',
                message: form.welcomeMessage,
                prompt: form.welcomePrompt,
                probability: form.welcomeProbability === 'inherit' ? undefined : form.welcomeProbability
            },
            goodbye: {
                enabled: form.goodbyeEnabled === 'on',
                prompt: form.goodbyePrompt,
                probability: form.goodbyeProbability === 'inherit' ? undefined : form.goodbyeProbability
            },
            poke: {
                enabled: form.pokeEnabled === 'on',
                pokeBack: form.pokeBack,
                probability: form.pokeProbability === 'inherit' ? undefined : form.pokeProbability
            },
            recall: {
                enabled: form.recallEnabled === 'on',
                probability: form.recallProbability === 'inherit' ? undefined : form.recallProbability
            },
            ban: {
                enabled: form.banEnabled === 'on',
                probability: form.banProbability === 'inherit' ? undefined : form.banProbability
            },
            luckyKing: {
                enabled: form.luckyKingEnabled === 'on',
                probability: form.luckyKingProbability === 'inherit' ? undefined : form.luckyKingProbability
            },
            honor: {
                enabled: form.honorEnabled === 'on',
                probability: form.honorProbability === 'inherit' ? undefined : form.honorProbability
            },
            essence: {
                enabled: form.essenceEnabled === 'on',
                probability: form.essenceProbability === 'inherit' ? undefined : form.essenceProbability
            },
            admin: {
                enabled: form.adminEnabled === 'on',
                probability: form.adminProbability === 'inherit' ? undefined : form.adminProbability
            }
        },

        // 表情包小偷
        emojiThief: {
            enabled: form.emojiThiefEnabled === 'on',
            independent: form.emojiThiefSeparateFolder,
            maxCount: form.emojiThiefMaxCount,
            probability: form.emojiThiefStealRate,
            triggerRate: form.emojiThiefTriggerRate,
            triggerMode: form.emojiThiefTriggerMode
        },

        // 黑白名单
        listMode: form.listMode,
        blacklist: form.blacklist,
        whitelist: form.whitelist,

        // 定时总结
        summary: {
            push: {
                enabled: form.summaryPushEnabled,
                intervalType: form.summaryPushIntervalType,
                intervalValue: form.summaryPushIntervalValue,
                pushHour: form.summaryPushHour,
                messageCount: form.summaryPushMessageCount
            }
        },

        // 绘图配置
        imageGen: {
            enabled: form.imageGenEnabled === 'on',
            modelId: form.imageGenModel,
            text2imgModel: form.text2imgModel,
            img2imgModel: form.img2imgModel,
            size: form.imageGenSize,
            quality: form.imageGenQuality,
            maxDailyLimit: form.imageGenDailyLimit
        },

        // 群独立渠道
        independentChannel: {
            hasChannel: form.independentChannelEnabled,
            baseUrl: form.independentBaseUrl,
            apiKey: form.independentApiKey,
            adapterType: form.independentAdapterType,
            forbidGlobal: form.forbidGlobalModel,
            channels: form.independentChannels
        },

        // 使用限制
        usageLimit: {
            dailyGroupLimit: form.dailyGroupLimit,
            dailyUserLimit: form.dailyUserLimit,
            limitMessage: form.usageLimitMessage
        },

        // 知识库
        knowledgeIds: form.knowledgeIds
    }

    return config
}

/**
 * 创建空的独立渠道配置
 */
export function createEmptyChannel(): IndependentChannel {
    return {
        id: crypto.randomUUID(),
        name: '',
        baseUrl: '',
        apiKey: '',
        adapterType: 'openai',
        models: [],
        enabled: true,
        priority: 0
    }
}

/**
 * 验证表单数据
 */
export function validateForm(form: GroupFormState): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // 验证群号
    if (!form.groupId) {
        errors.push('群号不能为空')
    }

    // 验证独立渠道配置
    if (form.independentChannelEnabled) {
        if (!form.independentBaseUrl && form.independentChannels.length === 0) {
            errors.push('启用独立渠道时，需要配置BaseUrl或添加渠道')
        }
        
        for (const channel of form.independentChannels) {
            if (channel.enabled && !channel.baseUrl) {
                errors.push(`渠道 "${channel.name || '未命名'}" 的 BaseUrl 不能为空`)
            }
        }
    }

    // 验证概率范围
    if (form.bymProbability !== 'inherit' && (form.bymProbability < 0 || form.bymProbability > 1)) {
        errors.push('伪人模式概率必须在 0-1 之间')
    }

    // 验证表情包配置
    if (form.emojiThiefMaxCount < 0) {
        errors.push('表情包最大数量不能为负数')
    }

    // 验证使用限制
    if (form.dailyGroupLimit < 0 || form.dailyUserLimit < 0) {
        errors.push('使用限制不能为负数')
    }

    return {
        valid: errors.length === 0,
        errors
    }
}

/**
 * 深度比较两个表单状态是否相等
 */
export function isFormEqual(a: GroupFormState, b: GroupFormState): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 获取表单修改的字段列表
 */
export function getModifiedFields(original: GroupFormState, current: GroupFormState): string[] {
    const modified: string[] = []
    const keys = Object.keys(original) as (keyof GroupFormState)[]

    for (const key of keys) {
        const originalVal = JSON.stringify(original[key])
        const currentVal = JSON.stringify(current[key])
        if (originalVal !== currentVal) {
            modified.push(key)
        }
    }

    return modified
}
