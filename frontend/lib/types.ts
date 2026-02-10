// ============ MCP 类型 ============

/**
 * MCP 传输类型
 */
export type McpTransportType = 'stdio' | 'npm' | 'npx' | 'sse' | 'http'

/**
 * 添加服务器表单数据
 */
export interface AddServerFormData {
    name: string
    type: McpTransportType
    command?: string
    args?: string
    package?: string
    url?: string
    headers?: string
    env?: string
}

// ============ 渠道类型 ============

export interface IndependentChannel {
    id: string
    name: string
    baseUrl: string
    apiKey: string
    adapterType: string
    models: string[]
    enabled: boolean
    priority: number
    // 高级配置
    modelsPath?: string
    chatPath?: string
    customHeaders?: Record<string, string>
    // 图片处理
    imageConfig?: {
        transferMode?: 'base64' | 'url' | 'auto'
        compress?: boolean
        quality?: number
        maxSize?: number
    }
}

export interface Channel {
    id: string
    name: string
    provider?: string
    models?: string[]
}

export interface Preset {
    id: string
    name: string
    description?: string
    systemPromptPreview?: string
}

// API 返回的群组配置结构
export interface GroupConfig {
    groupId: string
    groupName: string
    systemPrompt: string
    presetId: string
    triggerMode: string
    customPrefix: string
    enabled: boolean
    toolsEnabled?: boolean | string
    imageGenEnabled?: boolean | string
    summaryEnabled?: boolean | string
    eventHandler?: boolean | string
    emojiThief?: {
        enabled: boolean
        independent: boolean
        maxCount: number
        probability: number
        triggerRate?: number
        triggerMode?: string
    }
    bym?: {
        enabled?: boolean | string
        presetId: string
        prompt?: string
        probability?: number | string
        modelId: string
        temperature?: number | string
        maxTokens?: number | string
        proactive?: {
            enabled?: boolean
            probability?: number
            cooldown?: number
            maxDaily?: number
            minMessages?: number
            keywords?: string[]
            timeRange?: { start?: number; end?: number }
        }
        style?: {
            replyLength?: string
            useEmoji?: boolean
            personalityStrength?: number
        }
    }
    chat?: {
        enabled?: boolean
        contextLength?: number
        temperature?: number
        maxTokens?: number
        streamReply?: boolean
        quoteReply?: boolean
        showThinking?: boolean
    }
    imageGen?: {
        enabled?: boolean
        modelId?: string
        text2imgModel?: string
        img2imgModel?: string
        size?: string
        quality?: string
        style?: string
        maxDailyLimit?: number
    }
    models: {
        chat: string
        tools: string
        dispatch: string
        vision: string
        image: string
        search: string
        bym: string
        summary: string
        profile: string
    }
    blacklist: string[]
    whitelist: string[]
    listMode: string
    summary?: {
        enabled?: boolean
        modelId?: string
        push?: {
            enabled: boolean
            intervalType: 'day' | 'hour'
            intervalValue: number
            pushHour?: number
            messageCount?: number
        }
    }
    events?: {
        enabled?: boolean
        welcome?: { enabled?: boolean; message?: string; prompt?: string; useAI?: boolean; probability?: number }
        goodbye?: { enabled?: boolean; prompt?: string; useAI?: boolean; probability?: number }
        poke?: { enabled?: boolean; pokeBack?: boolean; message?: string; probability?: number }
        recall?: { enabled?: boolean; probability?: number }
        ban?: { enabled?: boolean; probability?: number }
        luckyKing?: { enabled?: boolean; probability?: number }
        honor?: { enabled?: boolean; probability?: number }
        essence?: { enabled?: boolean; probability?: number }
        admin?: { enabled?: boolean; probability?: number }
    }
    independentChannel?: {
        hasChannel?: boolean
        baseUrl?: string
        apiKey?: string
        adapterType?: string
        forbidGlobal?: boolean
        channels?: IndependentChannel[]
    }
    usageLimit?: {
        dailyGroupLimit?: number
        dailyUserLimit?: number
        limitMessage?: string
        chatLimit?: number
        imageLimit?: number
    }
    knowledgeIds?: string[]
    presets?: Preset[]
    channels?: Channel[]
    knowledgeBases?: { id: string; name: string }[]
    emojiStats?: {
        total: number
        images: { name: string; url: string }[]
    }
}

// 前端表单使用的扁平化状态
export interface GroupFormState {
    groupId: string
    groupName: string
    enabled: boolean
    presetId: string
    systemPrompt: string
    triggerMode: string
    customPrefix: string
    
    // 模型配置
    chatModel: string
    summaryModel: string
    bymModel: string
    imageGenModel: string
    
    // 功能开关
    toolsEnabled: 'inherit' | 'on' | 'off'
    imageGenEnabled: 'inherit' | 'on' | 'off'
    summaryEnabled: 'inherit' | 'on' | 'off'
    eventEnabled: 'inherit' | 'on' | 'off'
    
    // 伪人配置
    bymEnabled: 'inherit' | 'on' | 'off'
    bymPresetId: string
    bymPrompt: string
    bymProbability: 'inherit' | number
    bymTemperature: 'inherit' | number
    bymMaxTokens: 'inherit' | number
    bymReplyLength: string
    bymUseEmoji: boolean
    
    // 主动发言
    proactiveChatEnabled: 'inherit' | 'on' | 'off'
    proactiveChatProbability: 'inherit' | number
    proactiveChatCooldown: 'inherit' | number
    proactiveChatMaxDaily: 'inherit' | number
    proactiveChatMinMessages: number
    proactiveChatTimeStart: number
    proactiveChatTimeEnd: number
    
    // 事件配置
    welcomeEnabled: 'inherit' | 'on' | 'off'
    welcomeMessage: string
    welcomePrompt: string
    welcomeProbability: 'inherit' | number
    goodbyeEnabled: 'inherit' | 'on' | 'off'
    goodbyePrompt: string
    goodbyeProbability: 'inherit' | number
    pokeEnabled: 'inherit' | 'on' | 'off'
    pokeBack: boolean
    pokeProbability: 'inherit' | number
    
    // 其他事件
    recallEnabled: 'inherit' | 'on' | 'off'
    recallProbability: 'inherit' | number
    banEnabled: 'inherit' | 'on' | 'off'
    banProbability: 'inherit' | number
    luckyKingEnabled: 'inherit' | 'on' | 'off'
    luckyKingProbability: 'inherit' | number
    honorEnabled: 'inherit' | 'on' | 'off'
    honorProbability: 'inherit' | number
    essenceEnabled: 'inherit' | 'on' | 'off'
    essenceProbability: 'inherit' | number
    adminEnabled: 'inherit' | 'on' | 'off'
    adminProbability: 'inherit' | number
    
    // 表情包小偷/随机发图
    emojiThiefEnabled: 'inherit' | 'on' | 'off'
    emojiThiefSeparateFolder: boolean
    emojiThiefMaxCount: number
    emojiThiefStealRate: number
    emojiThiefTriggerRate: number
    emojiThiefTriggerMode: string
    
    // 聊天配置
    chatEnabled: boolean
    chatContextLength: number
    chatStreamReply: boolean
    chatQuoteReply: boolean
    chatShowThinking: boolean
    
    // 黑白名单
    listMode: string
    blacklist: string[]
    whitelist: string[]
    
    // 定时总结推送
    summaryPushEnabled: boolean
    summaryPushIntervalType: 'day' | 'hour'
    summaryPushIntervalValue: number
    summaryPushHour: number
    summaryPushMessageCount: number
    
    // 绘图配置
    text2imgModel: string
    img2imgModel: string
    imageGenSize: string
    imageGenQuality: string
    imageGenDailyLimit: number
    
    // 群独立渠道
    independentChannelEnabled: boolean
    independentBaseUrl: string
    independentApiKey: string
    independentAdapterType: string
    forbidGlobalModel: boolean
    independentChannels: IndependentChannel[]
    
    // 使用限制
    dailyGroupLimit: number
    dailyUserLimit: number
    usageLimitMessage: string
    
    // 知识库
    knowledgeIds: string[]
}
