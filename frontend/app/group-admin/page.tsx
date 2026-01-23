'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
    AlertCircle,
    Loader2,
    Save,
    Settings,
    Zap,
    Sparkles,
    BookOpen,
    RefreshCw,
    Power,
    X,
    Image,
    MessageSquare,
    PartyPopper,
    Palette,
    Bot,
    Users,
    Clock,
    Hand,
    UserPlus,
    UserMinus,
    Brain,
    Smile,
    Server,
    Trash2,
    Eye,
    EyeOff,
    Plus
} from 'lucide-react'

// 群独立渠道接口（完整配置）
interface IndependentChannel {
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

interface Channel {
    id: string
    name: string
    provider?: string
    models?: string[]
}

interface Preset {
    id: string
    name: string
    description?: string
    systemPromptPreview?: string
}

interface GroupConfig {
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
    emojiThief: {
        enabled: boolean
        independent: boolean
        maxCount: number
        probability: number
        triggerRate?: number
        triggerMode?: string
    }
    bym: {
        enabled?: boolean | string
        presetId: string
        prompt?: string
        probability?: number
        modelId: string
        temperature?: number
        maxTokens?: number
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
        welcome?: { enabled?: boolean; message?: string; prompt?: string; useAI?: boolean }
        goodbye?: { enabled?: boolean; prompt?: string; useAI?: boolean }
        poke?: { enabled?: boolean; pokeBack?: boolean; message?: string }
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
    presets: Preset[]
    channels: Channel[]
    knowledgeBases?: { id: string; name: string }[]
    emojiStats?: {
        total: number
        images: { name: string; url: string }[]
    }
}

export default function GroupAdminPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [groupId, setGroupId] = useState<string>('')
    const [error, setError] = useState<string>('')
    const [formTab, setFormTab] = useState('basic')
    const [emojiStats, setEmojiStats] = useState<{ total: number; images: { name: string; url: string }[] }>({
        total: 0,
        images: []
    })
    const [showApiKey, setShowApiKey] = useState(false)
    const [viewEmoji, setViewEmoji] = useState<{ name: string; url: string } | null>(null)

    const [form, setForm] = useState({
        groupId: '',
        groupName: '',
        presetId: '__default__',
        systemPrompt: '',
        enabled: true,
        triggerMode: 'default',
        customPrefix: '',
        // 功能开关
        toolsEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        imageGenEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        imageGenModel: '',
        imageGenSize: '1024x1024',
        imageGenQuality: 'standard',
        imageGenDailyLimit: 0,
        summaryEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        summaryModel: '',
        eventEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        // 表情小偷
        emojiThiefEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        emojiThiefSeparateFolder: true,
        emojiThiefMaxCount: 500,
        emojiThiefStealRate: 1.0,
        emojiThiefTriggerRate: 0.05,
        emojiThiefTriggerMode: 'off' as 'off' | 'chat_follow' | 'chat_random' | 'bym_follow' | 'bym_random',
        // 伪人
        bymEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        bymPresetId: '__default__',
        bymPrompt: '',
        bymProbability: 'inherit' as 'inherit' | number,
        bymModel: '',
        bymTemperature: 'inherit' as 'inherit' | number,
        bymMaxTokens: 'inherit' as 'inherit' | number,
        bymReplyLength: 'medium',
        bymUseEmoji: true,
        // 伪人 - 主动发言
        proactiveChatEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        proactiveChatProbability: 'inherit' as 'inherit' | number,
        proactiveChatCooldown: 'inherit' as 'inherit' | number,
        proactiveChatMaxDaily: 'inherit' as 'inherit' | number,
        proactiveChatMinMessages: 5,
        proactiveChatTimeStart: 8,
        proactiveChatTimeEnd: 23,
        // 聊天配置
        chatEnabled: true,
        chatContextLength: 20,
        chatStreamReply: true,
        chatQuoteReply: false,
        chatShowThinking: true,
        // 模型配置
        chatModel: '',
        // 黑白名单
        listMode: 'none',
        blacklist: [] as string[],
        whitelist: [] as string[],
        // 定时推送
        summaryPushEnabled: false,
        summaryPushIntervalType: 'day' as 'day' | 'hour',
        summaryPushIntervalValue: 1,
        summaryPushHour: 20,
        summaryPushMessageCount: 100,
        // 事件处理扩展
        welcomeEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        welcomeMessage: '',
        welcomePrompt: '',
        welcomeProbability: 'inherit' as 'inherit' | number,
        goodbyeEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        goodbyePrompt: '',
        goodbyeProbability: 'inherit' as 'inherit' | number,
        pokeEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        pokeBack: false,
        pokeProbability: 'inherit' as 'inherit' | number,
        // 其他事件
        recallEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        recallProbability: 'inherit' as 'inherit' | number,
        banEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        banProbability: 'inherit' as 'inherit' | number,
        luckyKingEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        luckyKingProbability: 'inherit' as 'inherit' | number,
        honorEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        honorProbability: 'inherit' as 'inherit' | number,
        essenceEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        essenceProbability: 'inherit' as 'inherit' | number,
        adminEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        adminProbability: 'inherit' as 'inherit' | number,
        // 知识库
        knowledgeIds: [] as string[],
        // 群独立渠道
        independentChannelEnabled: false,
        independentBaseUrl: '',
        independentApiKey: '',
        independentAdapterType: 'openai',
        forbidGlobalModel: false,
        independentChannels: [] as IndependentChannel[],
        // 使用限制
        dailyGroupLimit: 0,
        dailyUserLimit: 0,
        usageLimitMessage: ''
    })

    const [knowledgeBases, setKnowledgeBases] = useState<{ id: string; name: string }[]>([])
    const [presets, setPresets] = useState<Preset[]>([])
    const [allModels, setAllModels] = useState<string[]>([])

    // 渠道编辑相关状态
    const [channelDialogOpen, setChannelDialogOpen] = useState(false)
    const [editingChannelIndex, setEditingChannelIndex] = useState<number | null>(null)
    const [channelForm, setChannelForm] = useState({
        name: '',
        baseUrl: '',
        apiKey: '',
        adapterType: 'openai',
        models: '',
        enabled: true,
        priority: 0,
        // 高级配置
        modelsPath: '',
        chatPath: '',
        // 图片处理
        imageTransferMode: 'auto' as 'base64' | 'url' | 'auto',
        imageCompress: true,
        imageQuality: 85,
        imageMaxSize: 4096
    })
    const [fetchingModels, setFetchingModels] = useState(false)
    const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [selectedModels, setSelectedModels] = useState<string[]>([])

    // 登录状态
    const [needLogin, setNeedLogin] = useState(false)
    const [loginCode, setLoginCode] = useState('')
    const [loginLoading, setLoginLoading] = useState(false)

    useEffect(() => {
        // 优先从URL获取登录码（从群命令生成的链接）
        const urlParams = new URLSearchParams(window.location.search)
        const urlCode = urlParams.get('code')

        if (urlCode) {
            // 清除URL中的code参数
            window.history.replaceState({}, '', '/group-admin')
            // 自动使用登录码登录
            handleLoginWithCode(urlCode)
            return
        }

        // 从localStorage获取已保存的会话信息
        const token = localStorage.getItem('group_admin_token')
        if (!token) {
            setNeedLogin(true)
            setLoading(false)
            return
        }
        loadConfig(token)
    }, [])

    const handleLoginWithCode = async (code: string) => {
        setLoading(true)
        try {
            const res = await fetch('/api/group-admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code.toUpperCase() })
            })
            const data = await res.json()

            if (data.code === 0) {
                localStorage.setItem('group_admin_token', data.data.token)
                toast.success('登录成功')
                loadConfig(data.data.token)
            } else {
                toast.error(data.message || '登录码无效或已过期')
                setNeedLogin(true)
                setLoading(false)
            }
        } catch (err) {
            toast.error('登录失败，请检查网络')
            setNeedLogin(true)
            setLoading(false)
        }
    }

    const handleLogin = async () => {
        if (!loginCode.trim()) {
            toast.error('请输入登录码')
            return
        }

        setLoginLoading(true)
        try {
            const res = await fetch('/api/group-admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: loginCode.trim().toUpperCase() })
            })
            const data = await res.json()

            if (data.code === 0) {
                localStorage.setItem('group_admin_token', data.data.token)
                setNeedLogin(false)
                setLoginCode('')
                toast.success('登录成功')
                loadConfig(data.data.token)
            } else {
                toast.error(data.message || '登录失败')
            }
        } catch (err) {
            toast.error('登录失败，请检查网络')
        } finally {
            setLoginLoading(false)
        }
    }

    const handleLogout = () => {
        localStorage.removeItem('group_admin_token')
        setNeedLogin(true)
        setGroupId('')
        toast.success('已退出登录')
    }

    const getToken = () => localStorage.getItem('group_admin_token') || ''

    const loadConfig = async (token?: string) => {
        try {
            const res = await fetch('/api/group-admin/config', {
                headers: { Authorization: `Bearer ${token || getToken()}` }
            })
            if (!res.ok) {
                if (res.status === 401) {
                    localStorage.removeItem('group_admin_token')
                    setNeedLogin(true)
                    setLoading(false)
                    return
                }
                throw new Error('加载配置失败')
            }
            const data = await res.json()
            if (data.code === 0) {
                const c = data.data as GroupConfig
                setGroupId(c.groupId)
                setPresets(c.presets || [])

                // 提取所有模型（从渠道的 models 数组中）
                const models = new Set<string>()
                c.channels?.forEach(ch => {
                    if (ch.models && Array.isArray(ch.models)) {
                        ch.models.forEach(m => models.add(m))
                    }
                })
                setAllModels(Array.from(models).sort())

                // 填充表单
                setForm({
                    groupId: c.groupId,
                    groupName: c.groupName || '',
                    presetId: c.presetId || '__default__',
                    systemPrompt: c.systemPrompt || '',
                    enabled: c.enabled !== false,
                    triggerMode: c.triggerMode || 'default',
                    customPrefix: c.customPrefix || '',
                    toolsEnabled:
                        c.toolsEnabled === undefined
                            ? 'inherit'
                            : c.toolsEnabled === 'true' || c.toolsEnabled === true
                              ? 'on'
                              : 'off',
                    imageGenEnabled:
                        c.imageGenEnabled === undefined
                            ? 'inherit'
                            : c.imageGenEnabled === 'true' || c.imageGenEnabled === true
                              ? 'on'
                              : 'off',
                    imageGenModel: c.models?.image || '',
                    summaryEnabled:
                        c.summaryEnabled === undefined
                            ? 'inherit'
                            : c.summaryEnabled === 'true' || c.summaryEnabled === true
                              ? 'on'
                              : 'off',
                    summaryModel: c.models?.summary || '',
                    eventEnabled:
                        c.eventHandler === undefined
                            ? 'inherit'
                            : c.eventHandler === 'true' || c.eventHandler === true
                              ? 'on'
                              : 'off',
                    emojiThiefEnabled:
                        c.emojiThief?.enabled === undefined ? 'inherit' : c.emojiThief.enabled ? 'on' : 'off',
                    emojiThiefSeparateFolder: c.emojiThief?.independent ?? true,
                    emojiThiefMaxCount: c.emojiThief?.maxCount ?? 500,
                    emojiThiefStealRate: (c.emojiThief?.probability ?? 100) / 100,
                    emojiThiefTriggerRate: (c.emojiThief?.triggerRate ?? 5) / 100,
                    emojiThiefTriggerMode: (c.emojiThief?.triggerMode || 'off') as
                        | 'off'
                        | 'chat_follow'
                        | 'chat_random'
                        | 'bym_follow'
                        | 'bym_random',
                    bymEnabled:
                        c.bym?.enabled === undefined
                            ? 'inherit'
                            : c.bym.enabled === 'true' || c.bym.enabled === true
                              ? 'on'
                              : 'off',
                    bymPresetId: c.bym?.presetId || '__default__',
                    bymPrompt: c.bym?.prompt || '',
                    bymProbability: c.bym?.probability === undefined ? 'inherit' : c.bym.probability,
                    bymModel: c.bym?.modelId || '',
                    bymTemperature: c.bym?.temperature === undefined ? 'inherit' : c.bym.temperature,
                    bymMaxTokens: c.bym?.maxTokens === undefined ? 'inherit' : c.bym.maxTokens,
                    chatModel: c.models?.chat || '',
                    listMode: c.listMode || 'none',
                    blacklist: c.blacklist || [],
                    whitelist: c.whitelist || [],
                    summaryPushEnabled: c.summary?.push?.enabled || false,
                    summaryPushIntervalType: c.summary?.push?.intervalType || 'day',
                    summaryPushIntervalValue: c.summary?.push?.intervalValue || 1,
                    summaryPushHour: c.summary?.push?.pushHour ?? 20,
                    summaryPushMessageCount: c.summary?.push?.messageCount || 100,
                    // 事件处理扩展
                    welcomeEnabled:
                        c.events?.welcome?.enabled === undefined ? 'inherit' : c.events?.welcome?.enabled ? 'on' : 'off',
                    welcomeMessage: c.events?.welcome?.message || '',
                    welcomePrompt: c.events?.welcome?.prompt || '',
                    welcomeProbability: (c.events?.welcome as { probability?: number })?.probability ?? 'inherit',
                    goodbyeEnabled:
                        c.events?.goodbye?.enabled === undefined ? 'inherit' : c.events?.goodbye?.enabled ? 'on' : 'off',
                    goodbyePrompt: c.events?.goodbye?.prompt || '',
                    goodbyeProbability: (c.events?.goodbye as { probability?: number })?.probability ?? 'inherit',
                    pokeEnabled: c.events?.poke?.enabled === undefined ? 'inherit' : c.events?.poke?.enabled ? 'on' : 'off',
                    pokeBack: c.events?.poke?.pokeBack || false,
                    pokeProbability: (c.events?.poke as { probability?: number })?.probability ?? 'inherit',
                    // 其他事件
                    recallEnabled: (c.events as { recall?: { enabled?: boolean } })?.recall?.enabled === undefined ? 'inherit' : (c.events as { recall?: { enabled?: boolean } })?.recall?.enabled ? 'on' : 'off',
                    recallProbability: (c.events as { recall?: { probability?: number } })?.recall?.probability ?? 'inherit',
                    banEnabled: (c.events as { ban?: { enabled?: boolean } })?.ban?.enabled === undefined ? 'inherit' : (c.events as { ban?: { enabled?: boolean } })?.ban?.enabled ? 'on' : 'off',
                    banProbability: (c.events as { ban?: { probability?: number } })?.ban?.probability ?? 'inherit',
                    luckyKingEnabled: (c.events as { luckyKing?: { enabled?: boolean } })?.luckyKing?.enabled === undefined ? 'inherit' : (c.events as { luckyKing?: { enabled?: boolean } })?.luckyKing?.enabled ? 'on' : 'off',
                    luckyKingProbability: (c.events as { luckyKing?: { probability?: number } })?.luckyKing?.probability ?? 'inherit',
                    honorEnabled: (c.events as { honor?: { enabled?: boolean } })?.honor?.enabled === undefined ? 'inherit' : (c.events as { honor?: { enabled?: boolean } })?.honor?.enabled ? 'on' : 'off',
                    honorProbability: (c.events as { honor?: { probability?: number } })?.honor?.probability ?? 'inherit',
                    essenceEnabled: (c.events as { essence?: { enabled?: boolean } })?.essence?.enabled === undefined ? 'inherit' : (c.events as { essence?: { enabled?: boolean } })?.essence?.enabled ? 'on' : 'off',
                    essenceProbability: (c.events as { essence?: { probability?: number } })?.essence?.probability ?? 'inherit',
                    adminEnabled: (c.events as { admin?: { enabled?: boolean } })?.admin?.enabled === undefined ? 'inherit' : (c.events as { admin?: { enabled?: boolean } })?.admin?.enabled ? 'on' : 'off',
                    adminProbability: (c.events as { admin?: { probability?: number } })?.admin?.probability ?? 'inherit',
                    knowledgeIds: c.knowledgeIds || [],
                    // 伪人 - 主动发言
                    proactiveChatEnabled:
                        c.bym?.proactive?.enabled === undefined
                            ? 'inherit'
                            : c.bym?.proactive?.enabled
                              ? 'on'
                              : 'off',
                    proactiveChatProbability:
                        c.bym?.proactive?.probability === undefined ? 'inherit' : c.bym?.proactive?.probability,
                    proactiveChatCooldown: c.bym?.proactive?.cooldown === undefined ? 'inherit' : c.bym?.proactive?.cooldown,
                    proactiveChatMaxDaily: c.bym?.proactive?.maxDaily === undefined ? 'inherit' : c.bym?.proactive?.maxDaily,
                    proactiveChatMinMessages: c.bym?.proactive?.minMessages ?? 5,
                    proactiveChatTimeStart: c.bym?.proactive?.timeRange?.start ?? 8,
                    proactiveChatTimeEnd: c.bym?.proactive?.timeRange?.end ?? 23,
                    // 伪人 - 回复风格
                    bymReplyLength: c.bym?.style?.replyLength || 'medium',
                    bymUseEmoji: c.bym?.style?.useEmoji ?? true,
                    // 聊天配置
                    chatEnabled: c.chat?.enabled ?? true,
                    chatContextLength: c.chat?.contextLength ?? 20,
                    chatStreamReply: c.chat?.streamReply ?? true,
                    chatQuoteReply: c.chat?.quoteReply ?? false,
                    chatShowThinking: c.chat?.showThinking ?? true,
                    // 绘图配置
                    imageGenSize: c.imageGen?.size || '1024x1024',
                    imageGenQuality: c.imageGen?.quality || 'standard',
                    imageGenDailyLimit: c.imageGen?.maxDailyLimit ?? 0,
                    // 群独立渠道
                    independentChannelEnabled: c.independentChannel?.hasChannel || false,
                    independentBaseUrl: c.independentChannel?.baseUrl || '',
                    independentApiKey: c.independentChannel?.apiKey || '',
                    independentAdapterType: c.independentChannel?.adapterType || 'openai',
                    forbidGlobalModel: c.independentChannel?.forbidGlobal || false,
                    independentChannels: c.independentChannel?.channels || [],
                    // 使用限制
                    dailyGroupLimit: c.usageLimit?.dailyGroupLimit || 0,
                    dailyUserLimit: c.usageLimit?.dailyUserLimit || 0,
                    usageLimitMessage: c.usageLimit?.limitMessage || ''
                })
                // 设置知识库列表
                if (c.knowledgeBases) setKnowledgeBases(c.knowledgeBases)
                // 设置表情统计
                if (c.emojiStats) setEmojiStats(c.emojiStats)
            } else {
                throw new Error(data.message || '加载失败')
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const saveConfig = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/group-admin/config', {
                method: 'PUT',
                headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    groupName: form.groupName,
                    systemPrompt: form.systemPrompt || null,
                    presetId: form.presetId === '__default__' ? '' : form.presetId,
                    enabled: form.enabled,
                    triggerMode: form.triggerMode,
                    customPrefix: form.customPrefix || undefined,
                    toolsEnabled: form.toolsEnabled === 'inherit' ? undefined : form.toolsEnabled === 'on',
                    imageGenEnabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
                    summaryEnabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
                    eventHandler: form.eventEnabled === 'inherit' ? undefined : form.eventEnabled === 'on',
                    emojiThief: {
                        enabled: form.emojiThiefEnabled === 'inherit' ? undefined : form.emojiThiefEnabled === 'on',
                        independent: form.emojiThiefSeparateFolder,
                        maxCount: form.emojiThiefMaxCount,
                        probability: Math.round(form.emojiThiefStealRate * 100),
                        triggerRate: Math.round(form.emojiThiefTriggerRate * 100),
                        triggerMode: form.emojiThiefTriggerMode
                    },
                    bym: {
                        enabled: form.bymEnabled === 'inherit' ? undefined : form.bymEnabled === 'on',
                        presetId: form.bymPresetId === '__default__' ? undefined : form.bymPresetId,
                        prompt: form.bymPrompt || undefined,
                        probability: form.bymProbability === 'inherit' ? undefined : form.bymProbability,
                        modelId: form.bymModel || undefined,
                        temperature: form.bymTemperature === 'inherit' ? undefined : form.bymTemperature,
                        maxTokens: form.bymMaxTokens === 'inherit' ? undefined : form.bymMaxTokens,
                        proactive: {
                            enabled: form.proactiveChatEnabled === 'inherit' ? undefined : form.proactiveChatEnabled === 'on',
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
                    chat: {
                        enabled: form.chatEnabled,
                        contextLength: form.chatContextLength,
                        streamReply: form.chatStreamReply,
                        quoteReply: form.chatQuoteReply,
                        showThinking: form.chatShowThinking
                    },
                    imageGen: {
                        enabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
                        modelId: form.imageGenModel || undefined,
                        size: form.imageGenSize,
                        quality: form.imageGenQuality,
                        maxDailyLimit: form.imageGenDailyLimit
                    },
                    models: {
                        chat: form.chatModel || undefined,
                        summary: form.summaryModel || undefined
                    },
                    listMode: form.listMode,
                    blacklist: form.blacklist,
                    whitelist: form.whitelist,
                    summary: {
                        enabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
                        modelId: form.summaryModel || undefined,
                        push: {
                            enabled: form.summaryPushEnabled,
                            intervalType: form.summaryPushIntervalType,
                            intervalValue: form.summaryPushIntervalValue,
                            pushHour: form.summaryPushHour,
                            messageCount: form.summaryPushMessageCount
                        }
                    },
                    events: {
                        enabled: form.eventEnabled === 'inherit' ? undefined : form.eventEnabled === 'on',
                        welcome: {
                            enabled: form.welcomeEnabled === 'inherit' ? undefined : form.welcomeEnabled === 'on',
                            message: form.welcomeMessage || undefined,
                            prompt: form.welcomePrompt || undefined,
                            probability: form.welcomeProbability === 'inherit' ? undefined : form.welcomeProbability
                        },
                        goodbye: {
                            enabled: form.goodbyeEnabled === 'inherit' ? undefined : form.goodbyeEnabled === 'on',
                            prompt: form.goodbyePrompt || undefined,
                            probability: form.goodbyeProbability === 'inherit' ? undefined : form.goodbyeProbability
                        },
                        poke: {
                            enabled: form.pokeEnabled === 'inherit' ? undefined : form.pokeEnabled === 'on',
                            pokeBack: form.pokeBack,
                            probability: form.pokeProbability === 'inherit' ? undefined : form.pokeProbability
                        },
                        recall: {
                            enabled: form.recallEnabled === 'inherit' ? undefined : form.recallEnabled === 'on',
                            probability: form.recallProbability === 'inherit' ? undefined : form.recallProbability
                        },
                        ban: {
                            enabled: form.banEnabled === 'inherit' ? undefined : form.banEnabled === 'on',
                            probability: form.banProbability === 'inherit' ? undefined : form.banProbability
                        },
                        luckyKing: {
                            enabled: form.luckyKingEnabled === 'inherit' ? undefined : form.luckyKingEnabled === 'on',
                            probability: form.luckyKingProbability === 'inherit' ? undefined : form.luckyKingProbability
                        },
                        honor: {
                            enabled: form.honorEnabled === 'inherit' ? undefined : form.honorEnabled === 'on',
                            probability: form.honorProbability === 'inherit' ? undefined : form.honorProbability
                        },
                        essence: {
                            enabled: form.essenceEnabled === 'inherit' ? undefined : form.essenceEnabled === 'on',
                            probability: form.essenceProbability === 'inherit' ? undefined : form.essenceProbability
                        },
                        admin: {
                            enabled: form.adminEnabled === 'inherit' ? undefined : form.adminEnabled === 'on',
                            probability: form.adminProbability === 'inherit' ? undefined : form.adminProbability
                        }
                    },
                    independentChannel: {
                        baseUrl: form.independentBaseUrl || undefined,
                        apiKey: form.independentApiKey || undefined,
                        adapterType: form.independentAdapterType,
                        forbidGlobal: form.forbidGlobalModel,
                        channels: form.independentChannels.length > 0 ? form.independentChannels : undefined
                    },
                    usageLimit: {
                        dailyGroupLimit: form.dailyGroupLimit,
                        dailyUserLimit: form.dailyUserLimit,
                        limitMessage: form.usageLimitMessage || undefined
                    },
                    knowledgeIds: form.knowledgeIds.length > 0 ? form.knowledgeIds : undefined
                })
            })
            if (!res.ok) {
                if (res.status === 401) {
                    setError('认证已过期')
                    return
                }
                throw new Error('保存失败')
            }
            const data = await res.json()
            if (data.code === 0) toast.success('配置已保存')
            else throw new Error(data.message || '保存失败')
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSaving(false)
        }
    }

    const deleteEmoji = async (fileName: string) => {
        if (!confirm('确定要删除这个表情吗？')) return
        try {
            const res = await fetch(`/api/group-admin/emoji/delete?file=${encodeURIComponent(fileName)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (res.ok) {
                toast.success('已删除')
                setEmojiStats({
                    ...emojiStats,
                    total: emojiStats.total - 1,
                    images: emojiStats.images.filter(img => img.name !== fileName)
                })
            } else {
                throw new Error('删除失败')
            }
        } catch (err: any) {
            toast.error(err.message)
        }
    }

    const clearEmojis = async () => {
        if (!confirm('确定要清空所有表情吗？此操作不可撤销！')) return
        try {
            const res = await fetch('/api/group-admin/emoji/clear', {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (res.ok) {
                toast.success('已清空')
                setEmojiStats({ total: 0, images: [] })
            } else {
                throw new Error('清空失败')
            }
        } catch (err: any) {
            toast.error(err.message)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
        )
    }

    if (needLogin) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <Card className="w-full max-w-md mx-4">
                    <CardContent className="pt-6">
                        <div className="text-center mb-6">
                            <Settings className="h-12 w-12 text-blue-500 mx-auto" />
                            <h2 className="mt-4 text-xl font-semibold">群管理面板</h2>
                            <p className="mt-2 text-sm text-gray-500">请输入登录码登录</p>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="loginCode">登录码</Label>
                                <Input
                                    id="loginCode"
                                    placeholder="请输入6位登录码"
                                    value={loginCode}
                                    onChange={e => setLoginCode(e.target.value.toUpperCase())}
                                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                                    maxLength={6}
                                    className="text-center text-2xl tracking-widest font-mono"
                                />
                            </div>
                            <Button className="w-full" onClick={handleLogin} disabled={loginLoading}>
                                {loginLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                登录
                            </Button>
                            <p className="text-xs text-center text-gray-500">
                                在群内发送{' '}
                                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#群管理面板</code>{' '}
                                获取登录码
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <Card className="w-full max-w-md mx-4">
                    <CardContent className="pt-6 text-center">
                        <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
                        <h2 className="mt-4 text-xl font-semibold">{error}</h2>
                        <p className="mt-2 text-sm text-gray-500">请在群内发送 #群管理面板 重新获取登录码</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-6">
            <div className="max-w-3xl mx-auto px-4">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">群聊设置</h1>
                        <p className="text-sm text-muted-foreground">
                            群号: <Badge variant="secondary">{groupId}</Badge>
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => loadConfig()}>
                            <RefreshCw className="h-4 w-4 mr-1" /> 刷新
                        </Button>
                        <Button size="sm" onClick={saveConfig} disabled={saving}>
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                                <Save className="h-4 w-4 mr-1" />
                            )}
                            保存
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleLogout}>
                            退出
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardContent className="pt-6">
                        <Tabs value={formTab} onValueChange={setFormTab}>
                            <TabsList className="grid w-full grid-cols-5 mb-4">
                                <TabsTrigger value="basic">
                                    <Settings className="h-4 w-4 mr-1 hidden sm:inline" />
                                    基础
                                </TabsTrigger>
                                <TabsTrigger value="features">
                                    <Zap className="h-4 w-4 mr-1 hidden sm:inline" />
                                    功能
                                </TabsTrigger>
                                <TabsTrigger value="bym">
                                    <Sparkles className="h-4 w-4 mr-1 hidden sm:inline" />
                                    伪人
                                </TabsTrigger>
                                <TabsTrigger value="channel">
                                    <MessageSquare className="h-4 w-4 mr-1 hidden sm:inline" />
                                    对话
                                </TabsTrigger>
                                <TabsTrigger value="advanced">
                                    <BookOpen className="h-4 w-4 mr-1 hidden sm:inline" />
                                    高级
                                </TabsTrigger>
                            </TabsList>

                            <ScrollArea className="h-[calc(100vh-250px)] sm:h-[65vh] pr-4 -mr-4">
                                {/* 基础设置 */}
                                <TabsContent value="basic" className="space-y-4 mt-0">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>群号</Label>
                                            <Input value={form.groupId} disabled />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>群名称</Label>
                                            <Input
                                                value={form.groupName}
                                                onChange={e => setForm({ ...form, groupName: e.target.value })}
                                                placeholder="可选，便于识别"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>使用预设</Label>
                                            <Select
                                                value={form.presetId}
                                                onValueChange={v => setForm({ ...form, presetId: v })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="使用默认预设" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__default__">使用默认预设</SelectItem>
                                                    {presets.map(p => (
                                                        <SelectItem key={p.id} value={p.id}>
                                                            <div className="flex flex-col">
                                                                <span>{p.name}</span>
                                                                {p.description && (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        {p.description}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            {form.presetId && form.presetId !== '__default__' && (
                                                <p className="text-xs text-muted-foreground">
                                                    {presets.find(p => p.id === form.presetId)?.systemPromptPreview ||
                                                        ''}
                                                </p>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label>触发模式</Label>
                                            <Select
                                                value={form.triggerMode}
                                                onValueChange={v => setForm({ ...form, triggerMode: v })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="default">默认</SelectItem>
                                                    <SelectItem value="at">仅@触发</SelectItem>
                                                    <SelectItem value="prefix">仅前缀触发</SelectItem>
                                                    <SelectItem value="all">全部消息</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>自定义前缀</Label>
                                        <Input
                                            value={form.customPrefix}
                                            onChange={e => setForm({ ...form, customPrefix: e.target.value })}
                                            placeholder="留空使用全局前缀，如 #ai"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>独立人设</Label>
                                        <Textarea
                                            value={form.systemPrompt}
                                            onChange={e => setForm({ ...form, systemPrompt: e.target.value })}
                                            placeholder="不填写则使用预设配置..."
                                            rows={3}
                                            className="font-mono text-sm"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            支持变量: {'{{user_name}}'} {'{{group_name}}'} {'{{date}}'} 等 | 表达式:{' '}
                                            {'${e.user_id}'} (e为event)
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                        <div className="flex items-center gap-2">
                                            <Power className="h-4 w-4" />
                                            <Label>启用AI响应</Label>
                                        </div>
                                        <Switch
                                            checked={form.enabled}
                                            onCheckedChange={v => setForm({ ...form, enabled: v })}
                                        />
                                    </div>
                                </TabsContent>

                                {/* 功能设置 */}
                                <TabsContent value="features" className="space-y-3 mt-0">
                                    <p className="text-xs text-muted-foreground mb-2">
                                        群管理员也可通过命令控制这些功能
                                    </p>

                                    <FeatureItem
                                        icon={<Zap className="h-4 w-4" />}
                                        title="工具调用"
                                        desc="允许AI使用搜索、代码执行等工具"
                                        value={form.toolsEnabled}
                                        onChange={v => setForm({ ...form, toolsEnabled: v })}
                                    />

                                    <FeatureItem
                                        icon={<Image className="h-4 w-4" />}
                                        title="绘图功能"
                                        desc="文生图、图生图等"
                                        value={form.imageGenEnabled}
                                        onChange={v => setForm({ ...form, imageGenEnabled: v })}
                                    />
                                    {form.imageGenEnabled === 'on' && (
                                        <div className="ml-4 pl-4 border-l-2 border-muted space-y-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">绘图模型</Label>
                                                <Select
                                                    value={form.imageGenModel || '__default__'}
                                                    onValueChange={v => setForm({ ...form, imageGenModel: v === '__default__' ? '' : v })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="继承全局" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__default__">继承全局</SelectItem>
                                                        {allModels.map(m => (
                                                            <SelectItem key={m} value={m}>{m}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">图片尺寸</Label>
                                                    <Select
                                                        value={form.imageGenSize}
                                                        onValueChange={v => setForm({ ...form, imageGenSize: v })}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="1024x1024">1024x1024</SelectItem>
                                                            <SelectItem value="1792x1024">1792x1024 (横)</SelectItem>
                                                            <SelectItem value="1024x1792">1024x1792 (竖)</SelectItem>
                                                            <SelectItem value="512x512">512x512</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">图片质量</Label>
                                                    <Select
                                                        value={form.imageGenQuality}
                                                        onValueChange={v => setForm({ ...form, imageGenQuality: v })}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="standard">标准</SelectItem>
                                                            <SelectItem value="hd">高清</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">每日限制（0=无限）</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={form.imageGenDailyLimit}
                                                    onChange={e => setForm({ ...form, imageGenDailyLimit: parseInt(e.target.value) || 0 })}
                                                    placeholder="0"
                                                    className="w-24"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <FeatureItem
                                        icon={<MessageSquare className="h-4 w-4" />}
                                        title="群聊总结"
                                        desc="允许使用群聊总结"
                                        value={form.summaryEnabled}
                                        onChange={v => setForm({ ...form, summaryEnabled: v })}
                                    />
                                    {form.summaryEnabled === 'on' && (
                                        <ModelSubSelect
                                            label="总结模型"
                                            value={form.summaryModel}
                                            models={allModels}
                                            onChange={v => setForm({ ...form, summaryModel: v })}
                                        />
                                    )}

                                    <FeatureItem
                                        icon={<PartyPopper className="h-4 w-4" />}
                                        title="事件处理"
                                        desc="入群欢迎、退群提醒"
                                        value={form.eventEnabled}
                                        onChange={v => setForm({ ...form, eventEnabled: v })}
                                    />

                                    {/* 事件处理详细配置 */}
                                    {form.eventEnabled !== 'off' && (
                                        <div className="ml-4 pl-4 border-l-2 border-muted space-y-4">
                                            {/* 入群欢迎 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <UserPlus className="h-4 w-4 text-green-500" />
                                                        <Label className="text-sm font-medium">入群欢迎</Label>
                                                    </div>
                                                    <Select
                                                        value={form.welcomeEnabled}
                                                        onValueChange={(v: 'inherit' | 'on' | 'off') =>
                                                            setForm({ ...form, welcomeEnabled: v })
                                                        }
                                                    >
                                                        <SelectTrigger className="w-24">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.welcomeEnabled === 'on' && (
                                                    <div className="space-y-3 pl-6">
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-xs">响应概率</Label>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {Math.round((form.welcomeProbability === 'inherit' ? 1 : form.welcomeProbability as number) * 100)}%
                                                                </span>
                                                            </div>
                                                            <Slider
                                                                value={[form.welcomeProbability === 'inherit' ? 1 : form.welcomeProbability as number]}
                                                                onValueChange={([v]) => setForm({ ...form, welcomeProbability: v })}
                                                                min={0}
                                                                max={1}
                                                                step={0.05}
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">
                                                                固定欢迎语（不使用AI生成）
                                                            </Label>
                                                            <Textarea
                                                                value={form.welcomeMessage}
                                                                placeholder="留空则使用AI生成，支持 {nickname} {at} 变量"
                                                                onChange={e =>
                                                                    setForm({ ...form, welcomeMessage: e.target.value })
                                                                }
                                                                rows={2}
                                                                className="text-sm"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">AI欢迎提示词</Label>
                                                            <Textarea
                                                                value={form.welcomePrompt}
                                                                placeholder="为新成员生成欢迎消息时的提示..."
                                                                onChange={e =>
                                                                    setForm({ ...form, welcomePrompt: e.target.value })
                                                                }
                                                                rows={2}
                                                                className="text-sm"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 退群提醒 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <UserMinus className="h-4 w-4 text-red-500" />
                                                        <Label className="text-sm font-medium">退群提醒</Label>
                                                    </div>
                                                    <Select
                                                        value={form.goodbyeEnabled}
                                                        onValueChange={(v: 'inherit' | 'on' | 'off') =>
                                                            setForm({ ...form, goodbyeEnabled: v })
                                                        }
                                                    >
                                                        <SelectTrigger className="w-24">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.goodbyeEnabled === 'on' && (
                                                    <div className="space-y-3 pl-6">
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-xs">响应概率</Label>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {Math.round((form.goodbyeProbability === 'inherit' ? 1 : form.goodbyeProbability as number) * 100)}%
                                                                </span>
                                                            </div>
                                                            <Slider
                                                                value={[form.goodbyeProbability === 'inherit' ? 1 : form.goodbyeProbability as number]}
                                                                onValueChange={([v]) => setForm({ ...form, goodbyeProbability: v })}
                                                                min={0}
                                                                max={1}
                                                                step={0.05}
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">AI告别提示词</Label>
                                                            <Textarea
                                                                value={form.goodbyePrompt}
                                                                placeholder="为离开成员生成告别消息时的提示..."
                                                                onChange={e =>
                                                                    setForm({ ...form, goodbyePrompt: e.target.value })
                                                                }
                                                                rows={2}
                                                                className="text-sm"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 戳一戳 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Hand className="h-4 w-4 text-blue-500" />
                                                        <Label className="text-sm font-medium">戳一戳回复</Label>
                                                    </div>
                                                    <Select
                                                        value={form.pokeEnabled}
                                                        onValueChange={(v: 'inherit' | 'on' | 'off') =>
                                                            setForm({ ...form, pokeEnabled: v })
                                                        }
                                                    >
                                                        <SelectTrigger className="w-24">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.pokeEnabled === 'on' && (
                                                    <div className="space-y-3 pl-6">
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-xs">响应概率</Label>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {Math.round((form.pokeProbability === 'inherit' ? 1 : form.pokeProbability as number) * 100)}%
                                                                </span>
                                                            </div>
                                                            <Slider
                                                                value={[form.pokeProbability === 'inherit' ? 1 : form.pokeProbability as number]}
                                                                onValueChange={([v]) => setForm({ ...form, pokeProbability: v })}
                                                                min={0}
                                                                max={1}
                                                                step={0.05}
                                                            />
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Switch
                                                                checked={form.pokeBack}
                                                                onCheckedChange={v => setForm({ ...form, pokeBack: v })}
                                                            />
                                                            <Label className="text-xs">戳回去（而非文字回复）</Label>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 撤回响应 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">🔄</span>
                                                        <Label className="text-sm font-medium">撤回响应</Label>
                                                    </div>
                                                    <Select value={form.recallEnabled} onValueChange={(v: 'inherit' | 'on' | 'off') => {
                                                        const updates: Partial<typeof form> = { recallEnabled: v }
                                                        if (v === 'on' && form.recallProbability === 'inherit') updates.recallProbability = 1.0
                                                        setForm({ ...form, ...updates })
                                                    }}>
                                                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.recallEnabled === 'on' && (
                                                    <div className="pl-6 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs w-12">概率</Label>
                                                            <Slider value={[form.recallProbability === 'inherit' ? 1 : form.recallProbability as number]} onValueChange={([v]) => setForm({ ...form, recallProbability: v })} min={0} max={1} step={0.05} className="flex-1" />
                                                            <span className="text-xs w-10 text-right">{Math.round((form.recallProbability === 'inherit' ? 1 : form.recallProbability as number) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 禁言响应 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">🔇</span>
                                                        <Label className="text-sm font-medium">禁言响应</Label>
                                                    </div>
                                                    <Select value={form.banEnabled} onValueChange={(v: 'inherit' | 'on' | 'off') => {
                                                        const updates: Partial<typeof form> = { banEnabled: v }
                                                        if (v === 'on' && form.banProbability === 'inherit') updates.banProbability = 1.0
                                                        setForm({ ...form, ...updates })
                                                    }}>
                                                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.banEnabled === 'on' && (
                                                    <div className="pl-6 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs w-12">概率</Label>
                                                            <Slider value={[form.banProbability === 'inherit' ? 1 : form.banProbability as number]} onValueChange={([v]) => setForm({ ...form, banProbability: v })} min={0} max={1} step={0.05} className="flex-1" />
                                                            <span className="text-xs w-10 text-right">{Math.round((form.banProbability === 'inherit' ? 1 : form.banProbability as number) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 运气王响应 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">🧧</span>
                                                        <Label className="text-sm font-medium">运气王响应</Label>
                                                    </div>
                                                    <Select value={form.luckyKingEnabled} onValueChange={(v: 'inherit' | 'on' | 'off') => {
                                                        const updates: Partial<typeof form> = { luckyKingEnabled: v }
                                                        if (v === 'on' && form.luckyKingProbability === 'inherit') updates.luckyKingProbability = 1.0
                                                        setForm({ ...form, ...updates })
                                                    }}>
                                                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.luckyKingEnabled === 'on' && (
                                                    <div className="pl-6 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs w-12">概率</Label>
                                                            <Slider value={[form.luckyKingProbability === 'inherit' ? 1 : form.luckyKingProbability as number]} onValueChange={([v]) => setForm({ ...form, luckyKingProbability: v })} min={0} max={1} step={0.05} className="flex-1" />
                                                            <span className="text-xs w-10 text-right">{Math.round((form.luckyKingProbability === 'inherit' ? 1 : form.luckyKingProbability as number) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 荣誉变更响应 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">🏆</span>
                                                        <Label className="text-sm font-medium">荣誉变更</Label>
                                                    </div>
                                                    <Select value={form.honorEnabled} onValueChange={(v: 'inherit' | 'on' | 'off') => {
                                                        const updates: Partial<typeof form> = { honorEnabled: v }
                                                        if (v === 'on' && form.honorProbability === 'inherit') updates.honorProbability = 1.0
                                                        setForm({ ...form, ...updates })
                                                    }}>
                                                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.honorEnabled === 'on' && (
                                                    <div className="pl-6 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs w-12">概率</Label>
                                                            <Slider value={[form.honorProbability === 'inherit' ? 1 : form.honorProbability as number]} onValueChange={([v]) => setForm({ ...form, honorProbability: v })} min={0} max={1} step={0.05} className="flex-1" />
                                                            <span className="text-xs w-10 text-right">{Math.round((form.honorProbability === 'inherit' ? 1 : form.honorProbability as number) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 精华消息响应 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">⭐</span>
                                                        <Label className="text-sm font-medium">精华消息</Label>
                                                    </div>
                                                    <Select value={form.essenceEnabled} onValueChange={(v: 'inherit' | 'on' | 'off') => {
                                                        const updates: Partial<typeof form> = { essenceEnabled: v }
                                                        if (v === 'on' && form.essenceProbability === 'inherit') updates.essenceProbability = 1.0
                                                        setForm({ ...form, ...updates })
                                                    }}>
                                                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.essenceEnabled === 'on' && (
                                                    <div className="pl-6 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs w-12">概率</Label>
                                                            <Slider value={[form.essenceProbability === 'inherit' ? 1 : form.essenceProbability as number]} onValueChange={([v]) => setForm({ ...form, essenceProbability: v })} min={0} max={1} step={0.05} className="flex-1" />
                                                            <span className="text-xs w-10 text-right">{Math.round((form.essenceProbability === 'inherit' ? 1 : form.essenceProbability as number) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 管理员变更响应 */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm">👑</span>
                                                        <Label className="text-sm font-medium">管理员变更</Label>
                                                    </div>
                                                    <Select value={form.adminEnabled} onValueChange={(v: 'inherit' | 'on' | 'off') => {
                                                        const updates: Partial<typeof form> = { adminEnabled: v }
                                                        if (v === 'on' && form.adminProbability === 'inherit') updates.adminProbability = 1.0
                                                        setForm({ ...form, ...updates })
                                                    }}>
                                                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {form.adminEnabled === 'on' && (
                                                    <div className="pl-6 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                            <Label className="text-xs w-12">概率</Label>
                                                            <Slider value={[form.adminProbability === 'inherit' ? 1 : form.adminProbability as number]} onValueChange={([v]) => setForm({ ...form, adminProbability: v })} min={0} max={1} step={0.05} className="flex-1" />
                                                            <span className="text-xs w-10 text-right">{Math.round((form.adminProbability === 'inherit' ? 1 : form.adminProbability as number) * 100)}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <FeatureItem
                                        icon={<Palette className="h-4 w-4 text-pink-500" />}
                                        title="表情小偷"
                                        desc="收集并发送表情包"
                                        value={form.emojiThiefEnabled}
                                        onChange={v => setForm({ ...form, emojiThiefEnabled: v })}
                                    />
                                    {form.emojiThiefEnabled !== 'off' && (
                                        <div className="ml-4 pl-4 border-l-2 border-muted space-y-4">
                                            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                                                <div className="space-y-1">
                                                    <Label className="text-sm font-medium">独立存储</Label>
                                                    <p className="text-xs text-muted-foreground">
                                                        开启后本群表情独立存储，不与其他群共享
                                                    </p>
                                                </div>
                                                <Switch
                                                    checked={form.emojiThiefSeparateFolder}
                                                    onCheckedChange={v =>
                                                        setForm({ ...form, emojiThiefSeparateFolder: v })
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">最大存储数量</Label>
                                                    <Input
                                                        type="number"
                                                        min={10}
                                                        max={5000}
                                                        value={form.emojiThiefMaxCount}
                                                        onChange={e =>
                                                            setForm({
                                                                ...form,
                                                                emojiThiefMaxCount: parseInt(e.target.value) || 500
                                                            })
                                                        }
                                                        className="h-8"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">收集概率 (%)</Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={100}
                                                        value={Math.round(form.emojiThiefStealRate * 100)}
                                                        onChange={e =>
                                                            setForm({
                                                                ...form,
                                                                emojiThiefStealRate: parseInt(e.target.value) / 100
                                                            })
                                                        }
                                                        className="h-8"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">发送模式</Label>
                                                    <Select
                                                        value={form.emojiThiefTriggerMode || 'off'}
                                                        onValueChange={(
                                                            v:
                                                                | 'off'
                                                                | 'chat_follow'
                                                                | 'chat_random'
                                                                | 'bym_follow'
                                                                | 'bym_random'
                                                        ) => setForm({ ...form, emojiThiefTriggerMode: v })}
                                                    >
                                                        <SelectTrigger className="h-8">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="off">关闭自动发送</SelectItem>
                                                            <SelectItem value="chat_follow">对话跟随</SelectItem>
                                                            <SelectItem value="chat_random">对话随机</SelectItem>
                                                            <SelectItem value="bym_follow">伪人跟随</SelectItem>
                                                            <SelectItem value="bym_random">伪人随机</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">发送概率 (%)</Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={100}
                                                        value={Math.round((form.emojiThiefTriggerRate ?? 0.05) * 100)}
                                                        onChange={e =>
                                                            setForm({
                                                                ...form,
                                                                emojiThiefTriggerRate: parseInt(e.target.value) / 100
                                                            })
                                                        }
                                                        className="h-8"
                                                        disabled={
                                                            form.emojiThiefTriggerMode === 'off' ||
                                                            form.emojiThiefTriggerMode === 'chat_follow' ||
                                                            form.emojiThiefTriggerMode === 'bym_follow'
                                                        }
                                                    />
                                                </div>
                                            </div>

                                            {/* 表情库管理预览 */}
                                            <div className="mt-4 p-3 rounded-lg border bg-card">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2">
                                                        <Smile className="h-4 w-4 text-yellow-500" />
                                                        <span className="text-sm font-medium">表情库预览</span>
                                                        <Badge variant="secondary" className="text-[10px]">{emojiStats.total} 张</Badge>
                                                    </div>
                                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={clearEmojis}>
                                                        <Trash2 className="h-3 w-3 mr-1" /> 清空
                                                    </Button>
                                                </div>
                                                
                                                {emojiStats.images.length > 0 ? (
                                                    <div className="grid grid-cols-5 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                                        {emojiStats.images.map((img, idx) => (
                                                            <div key={idx} className="relative group aspect-square rounded border bg-muted/50 overflow-hidden cursor-pointer" onClick={() => setViewEmoji(img)}>
                                                                <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                                                <button 
                                                                    className="absolute top-0 right-0 p-1 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        deleteEmoji(img.name);
                                                                    }}
                                                                >
                                                                    <X className="h-3 w-3" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-4 text-xs text-muted-foreground">
                                                        暂无表情，开启收集后会自动抓取
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* 黑白名单 */}
                                    <div className="border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-md bg-muted">
                                                    <Users className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">用户权限管理</p>
                                                    <p className="text-xs text-muted-foreground">设置黑白名单</p>
                                                </div>
                                            </div>
                                            <Select
                                                value={form.listMode}
                                                onValueChange={v => setForm({ ...form, listMode: v })}
                                            >
                                                <SelectTrigger className="w-28">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">不启用</SelectItem>
                                                    <SelectItem value="blacklist">黑名单</SelectItem>
                                                    <SelectItem value="whitelist">白名单</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {form.listMode === 'blacklist' && (
                                            <Textarea
                                                className="mt-2 font-mono"
                                                placeholder="每行一个QQ号"
                                                value={form.blacklist.join('\n')}
                                                onChange={e =>
                                                    setForm({
                                                        ...form,
                                                        blacklist: e.target.value.split('\n').filter(Boolean)
                                                    })
                                                }
                                            />
                                        )}
                                        {form.listMode === 'whitelist' && (
                                            <Textarea
                                                className="mt-2 font-mono"
                                                placeholder="每行一个QQ号"
                                                value={form.whitelist.join('\n')}
                                                onChange={e =>
                                                    setForm({
                                                        ...form,
                                                        whitelist: e.target.value.split('\n').filter(Boolean)
                                                    })
                                                }
                                            />
                                        )}
                                    </div>

                                    {/* 定时推送 */}
                                    <div className="border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-md bg-muted">
                                                    <Clock className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">定时总结推送</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        定期推送群聊总结报告
                                                    </p>
                                                </div>
                                            </div>
                                            <Switch
                                                checked={form.summaryPushEnabled}
                                                onCheckedChange={v => setForm({ ...form, summaryPushEnabled: v })}
                                            />
                                        </div>
                                        {form.summaryPushEnabled && (
                                            <div className="ml-4 pl-4 border-l-2 border-muted space-y-3 mt-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">间隔类型</Label>
                                                        <Select
                                                            value={form.summaryPushIntervalType}
                                                            onValueChange={(v: 'day' | 'hour') =>
                                                                setForm({ ...form, summaryPushIntervalType: v })
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="day">按天</SelectItem>
                                                                <SelectItem value="hour">按小时</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">间隔值</Label>
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            value={form.summaryPushIntervalValue}
                                                            onChange={e =>
                                                                setForm({
                                                                    ...form,
                                                                    summaryPushIntervalValue:
                                                                        parseInt(e.target.value) || 1
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                {form.summaryPushIntervalType === 'day' && (
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">推送时间 (0-23点)</Label>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            max={23}
                                                            value={form.summaryPushHour}
                                                            onChange={e =>
                                                                setForm({
                                                                    ...form,
                                                                    summaryPushHour: parseInt(e.target.value)
                                                                })
                                                            }
                                                            className="w-24"
                                                        />
                                                    </div>
                                                )}
                                                <div className="space-y-1">
                                                    <Label className="text-xs">消息数量</Label>
                                                    <Input
                                                        type="number"
                                                        min={10}
                                                        max={500}
                                                        value={form.summaryPushMessageCount}
                                                        onChange={e =>
                                                            setForm({
                                                                ...form,
                                                                summaryPushMessageCount: parseInt(e.target.value) || 100
                                                            })
                                                        }
                                                        className="w-24"
                                                    />
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    每次总结获取指定数量的新消息，不会重复总结已处理的消息
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                {/* 伪人设置 */}
                                <TabsContent value="bym" className="space-y-4 mt-0">
                                    <FeatureItem
                                        icon={<Sparkles className="h-4 w-4 text-purple-500" />}
                                        title="伪人模式"
                                        desc="随机回复，模拟真人聊天"
                                        value={form.bymEnabled}
                                        onChange={v => setForm({ ...form, bymEnabled: v })}
                                    />

                                    {form.bymEnabled !== 'off' && (
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>伪人人设</Label>
                                                <Select
                                                    value={form.bymPresetId}
                                                    onValueChange={v => setForm({ ...form, bymPresetId: v })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="选择人设..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="__default__">使用默认预设</SelectItem>
                                                        <SelectItem value="__custom__">自定义提示词</SelectItem>
                                                        {presets.map(p => (
                                                            <SelectItem key={p.id} value={p.id}>
                                                                <div className="flex flex-col">
                                                                    <span>{p.name}</span>
                                                                    {p.description && (
                                                                        <span className="text-xs text-muted-foreground">
                                                                            {p.description}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {form.bymPresetId &&
                                                    form.bymPresetId !== '__default__' &&
                                                    form.bymPresetId !== '__custom__' && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {presets.find(p => p.id === form.bymPresetId)
                                                                ?.systemPromptPreview || ''}
                                                        </p>
                                                    )}
                                            </div>

                                            {form.bymPresetId === '__custom__' && (
                                                <div className="space-y-2">
                                                    <Label>自定义提示词</Label>
                                                    <Textarea
                                                        value={form.bymPrompt}
                                                        onChange={e => setForm({ ...form, bymPrompt: e.target.value })}
                                                        placeholder="你是一个真实的群友..."
                                                        rows={3}
                                                        className="font-mono text-sm"
                                                    />
                                                </div>
                                            )}

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-sm">触发概率</Label>
                                                    {form.bymProbability === 'inherit' ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-full"
                                                            onClick={() => setForm({ ...form, bymProbability: 0.02 })}
                                                        >
                                                            继承全局
                                                        </Button>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                max={100}
                                                                className="w-20"
                                                                value={
                                                                    typeof form.bymProbability === 'number'
                                                                        ? Math.round(form.bymProbability * 100)
                                                                        : 2
                                                                }
                                                                onChange={e =>
                                                                    setForm({
                                                                        ...form,
                                                                        bymProbability: parseInt(e.target.value) / 100
                                                                    })
                                                                }
                                                            />
                                                            <span className="text-sm">%</span>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    setForm({ ...form, bymProbability: 'inherit' })
                                                                }
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-sm">使用模型</Label>
                                                    <Select
                                                        value={form.bymModel || '__default__'}
                                                        onValueChange={v =>
                                                            setForm({ ...form, bymModel: v === '__default__' ? '' : v })
                                                        }
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="继承" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="__default__">继承全局</SelectItem>
                                                            {allModels.map(m => (
                                                                <SelectItem key={m} value={m}>
                                                                    {m}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-sm">温度</Label>
                                                    {form.bymTemperature === 'inherit' ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-full"
                                                            onClick={() => setForm({ ...form, bymTemperature: 0.9 })}
                                                        >
                                                            继承全局
                                                        </Button>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                max={2}
                                                                step={0.1}
                                                                value={
                                                                    typeof form.bymTemperature === 'number'
                                                                        ? form.bymTemperature
                                                                        : 0.9
                                                                }
                                                                onChange={e =>
                                                                    setForm({
                                                                        ...form,
                                                                        bymTemperature: parseFloat(e.target.value)
                                                                    })
                                                                }
                                                            />
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    setForm({ ...form, bymTemperature: 'inherit' })
                                                                }
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-sm">最大Token</Label>
                                                    {form.bymMaxTokens === 'inherit' ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-full"
                                                            onClick={() => setForm({ ...form, bymMaxTokens: 100 })}
                                                        >
                                                            继承全局
                                                        </Button>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                type="number"
                                                                min={10}
                                                                max={2000}
                                                                value={
                                                                    typeof form.bymMaxTokens === 'number'
                                                                        ? form.bymMaxTokens
                                                                        : 100
                                                                }
                                                                onChange={e =>
                                                                    setForm({
                                                                        ...form,
                                                                        bymMaxTokens: parseInt(e.target.value)
                                                                    })
                                                                }
                                                            />
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    setForm({ ...form, bymMaxTokens: 'inherit' })
                                                                }
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 主动发言（伪人扩展） */}
                                            <div className="border-t pt-4 mt-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2">
                                                        <MessageSquare className="h-4 w-4 text-green-500" />
                                                        <Label className="font-medium">主动发言</Label>
                                                    </div>
                                                    <Select
                                                        value={form.proactiveChatEnabled}
                                                        onValueChange={v =>
                                                            setForm({
                                                                ...form,
                                                                proactiveChatEnabled: v as 'inherit' | 'on' | 'off'
                                                            })
                                                        }
                                                    >
                                                        <SelectTrigger className="w-24">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="inherit">继承</SelectItem>
                                                            <SelectItem value="on">开启</SelectItem>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <p className="text-xs text-muted-foreground mb-3">
                                                    伪人模式下允许机器人主动发言
                                                </p>

                                                {form.proactiveChatEnabled !== 'off' && (
                                                    <div className="space-y-3 ml-4 pl-4 border-l-2 border-muted">
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">触发概率</Label>
                                                                <Select
                                                                    value={
                                                                        form.proactiveChatProbability === 'inherit'
                                                                            ? 'inherit'
                                                                            : String(form.proactiveChatProbability)
                                                                    }
                                                                    onValueChange={v =>
                                                                        setForm({
                                                                            ...form,
                                                                            proactiveChatProbability:
                                                                                v === 'inherit' ? 'inherit' : parseFloat(v)
                                                                        })
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="inherit">继承</SelectItem>
                                                                        <SelectItem value="0.02">2%</SelectItem>
                                                                        <SelectItem value="0.05">5%</SelectItem>
                                                                        <SelectItem value="0.1">10%</SelectItem>
                                                                        <SelectItem value="0.2">20%</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">冷却(分钟)</Label>
                                                                <Select
                                                                    value={
                                                                        form.proactiveChatCooldown === 'inherit'
                                                                            ? 'inherit'
                                                                            : String(form.proactiveChatCooldown)
                                                                    }
                                                                    onValueChange={v =>
                                                                        setForm({
                                                                            ...form,
                                                                            proactiveChatCooldown:
                                                                                v === 'inherit' ? 'inherit' : parseInt(v)
                                                                        })
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="inherit">继承</SelectItem>
                                                                        <SelectItem value="5">5分钟</SelectItem>
                                                                        <SelectItem value="10">10分钟</SelectItem>
                                                                        <SelectItem value="30">30分钟</SelectItem>
                                                                        <SelectItem value="60">1小时</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">每日上限</Label>
                                                                <Select
                                                                    value={
                                                                        form.proactiveChatMaxDaily === 'inherit'
                                                                            ? 'inherit'
                                                                            : String(form.proactiveChatMaxDaily)
                                                                    }
                                                                    onValueChange={v =>
                                                                        setForm({
                                                                            ...form,
                                                                            proactiveChatMaxDaily:
                                                                                v === 'inherit' ? 'inherit' : parseInt(v)
                                                                        })
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="inherit">继承</SelectItem>
                                                                        <SelectItem value="5">5次</SelectItem>
                                                                        <SelectItem value="10">10次</SelectItem>
                                                                        <SelectItem value="20">20次</SelectItem>
                                                                        <SelectItem value="50">50次</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">最少消息</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    max={50}
                                                                    value={form.proactiveChatMinMessages}
                                                                    onChange={e =>
                                                                        setForm({
                                                                            ...form,
                                                                            proactiveChatMinMessages: parseInt(e.target.value) || 5
                                                                        })
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">活跃时段开始</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    max={23}
                                                                    value={form.proactiveChatTimeStart}
                                                                    onChange={e =>
                                                                        setForm({
                                                                            ...form,
                                                                            proactiveChatTimeStart: parseInt(e.target.value) || 8
                                                                        })
                                                                    }
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">活跃时段结束</Label>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    max={23}
                                                                    value={form.proactiveChatTimeEnd}
                                                                    onChange={e =>
                                                                        setForm({
                                                                            ...form,
                                                                            proactiveChatTimeEnd: parseInt(e.target.value) || 23
                                                                        })
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* 回复风格 */}
                                            <div className="border-t pt-4 mt-4">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <Smile className="h-4 w-4 text-yellow-500" />
                                                    <Label className="font-medium">回复风格</Label>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">回复长度</Label>
                                                        <Select
                                                            value={form.bymReplyLength}
                                                            onValueChange={v => setForm({ ...form, bymReplyLength: v })}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="short">简短</SelectItem>
                                                                <SelectItem value="medium">适中</SelectItem>
                                                                <SelectItem value="long">详细</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="flex items-center gap-2 pt-5">
                                                        <Switch
                                                            checked={form.bymUseEmoji}
                                                            onCheckedChange={v => setForm({ ...form, bymUseEmoji: v })}
                                                        />
                                                        <Label className="text-sm">使用表情</Label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </TabsContent>

                                {/* 渠道与限制 */}
                                <TabsContent value="channel" className="space-y-4 mt-0">
                                    {/* 聊天配置 */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4 text-blue-500" />
                                            <Label className="text-base font-medium">聊天配置</Label>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            配置本群的聊天行为和回复方式
                                        </p>

                                        <div className="space-y-3 p-3 rounded-lg border bg-card">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">上下文长度</Label>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={100}
                                                        value={form.chatContextLength}
                                                        onChange={e => setForm({ ...form, chatContextLength: parseInt(e.target.value) || 20 })}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2 pt-5">
                                                    <Switch
                                                        checked={form.chatEnabled}
                                                        onCheckedChange={v => setForm({ ...form, chatEnabled: v })}
                                                    />
                                                    <Label className="text-sm">启用对话</Label>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={form.chatStreamReply}
                                                        onCheckedChange={v => setForm({ ...form, chatStreamReply: v })}
                                                    />
                                                    <Label className="text-xs">流式回复</Label>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={form.chatQuoteReply}
                                                        onCheckedChange={v => setForm({ ...form, chatQuoteReply: v })}
                                                    />
                                                    <Label className="text-xs">引用回复</Label>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={form.chatShowThinking}
                                                        onCheckedChange={v => setForm({ ...form, chatShowThinking: v })}
                                                    />
                                                    <Label className="text-xs">显示思考</Label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 群独立渠道 */}
                                    <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Server className="h-4 w-4 text-purple-500" />
                                                <Label className="text-base font-medium">群独立渠道</Label>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setEditingChannelIndex(null)
                                                    setChannelForm({
                                                        name: '',
                                                        baseUrl: '',
                                                        apiKey: '',
                                                        adapterType: 'openai',
                                                        models: '',
                                                        enabled: true,
                                                        priority: 0,
                                                        modelsPath: '',
                                                        chatPath: '',
                                                        imageTransferMode: 'auto',
                                                        imageCompress: true,
                                                        imageQuality: 85,
                                                        imageMaxSize: 4096
                                                    })
                                                    setChannelDialogOpen(true)
                                                }}
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                添加渠道
                                            </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            配置本群专用的API渠道，优先级高于全局配置。支持配置多个渠道，按优先级顺序调用。
                                        </p>

                                        {form.independentChannels.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                                                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                                <p>暂无独立渠道</p>
                                                <p className="text-xs">点击上方按钮添加渠道</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {form.independentChannels.map((channel, index) => (
                                                    <div key={channel.id} className="p-4 rounded-lg border bg-card">
                                                        <div className="flex items-start justify-between">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-medium">{channel.name}</h4>
                                                                    <Badge variant={channel.enabled ? 'default' : 'secondary'}>
                                                                        {channel.enabled ? '启用' : '禁用'}
                                                                    </Badge>
                                                                    <Badge variant="outline">{channel.adapterType}</Badge>
                                                                    <Badge variant="outline">权重: {channel.priority}</Badge>
                                                                </div>
                                                                <p className="text-xs text-muted-foreground mt-1 truncate">
                                                                    {channel.baseUrl || '使用默认地址'}
                                                                </p>
                                                                <div className="flex gap-2 mt-2">
                                                                    {channel.models.slice(0, 3).map(model => (
                                                                        <Badge key={model} variant="secondary" className="text-xs font-normal">
                                                                            {model}
                                                                        </Badge>
                                                                    ))}
                                                                    {channel.models.length > 3 && (
                                                                        <Badge variant="secondary" className="text-xs font-normal">
                                                                            +{channel.models.length - 3}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => {
                                                                        setEditingChannelIndex(index)
                                                                        setChannelForm({
                                                                            name: channel.name,
                                                                            baseUrl: channel.baseUrl,
                                                                            apiKey: channel.apiKey,
                                                                            adapterType: channel.adapterType,
                                                                            models: channel.models.join(','),
                                                                            enabled: channel.enabled,
                                                                            priority: channel.priority,
                                                                            modelsPath: channel.modelsPath || '',
                                                                            chatPath: channel.chatPath || '',
                                                                            imageTransferMode: channel.imageConfig?.transferMode || 'auto',
                                                                            imageCompress: channel.imageConfig?.compress ?? true,
                                                                            imageQuality: channel.imageConfig?.quality ?? 85,
                                                                            imageMaxSize: channel.imageConfig?.maxSize ?? 4096
                                                                        })
                                                                        setChannelDialogOpen(true)
                                                                    }}
                                                                >
                                                                    <Settings className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="text-destructive"
                                                                    onClick={() => {
                                                                        if (confirm('确定要删除这个渠道吗？')) {
                                                                            const newChannels = [...form.independentChannels]
                                                                            newChannels.splice(index, 1)
                                                                            setForm({ ...form, independentChannels: newChannels })
                                                                        }
                                                                    }}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between p-2 rounded bg-muted/50 mt-2">
                                            <div className="space-y-0.5">
                                                <Label className="text-xs font-medium">禁用全局渠道</Label>
                                                <p className="text-[10px] text-muted-foreground text-orange-500">开启后本群仅使用独立渠道</p>
                                            </div>
                                            <Switch
                                                checked={form.forbidGlobalModel}
                                                onCheckedChange={v => setForm({ ...form, forbidGlobalModel: v })}
                                            />
                                        </div>
                                    </div>
                                </TabsContent>

                                {/* 高级设置 */}
                                <TabsContent value="advanced" className="space-y-4 mt-0">
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Bot className="h-4 w-4 text-muted-foreground" />
                                            <Label>模型配置</Label>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            为本群配置各场景独立模型（留空使用全局配置）
                                        </p>

                                        <div className="grid grid-cols-2 gap-3">
                                            <ModelConfigItem
                                                label="对话模型"
                                                desc="主模型"
                                                value={form.chatModel}
                                                models={allModels}
                                                onChange={v => setForm({ ...form, chatModel: v })}
                                            />
                                            <ModelConfigItem
                                                label="总结模型"
                                                desc="群聊总结"
                                                value={form.summaryModel}
                                                models={allModels}
                                                onChange={v => setForm({ ...form, summaryModel: v })}
                                            />
                                            <ModelConfigItem
                                                label="伪人模型"
                                                desc="伪人回复"
                                                value={form.bymModel}
                                                models={allModels}
                                                onChange={v => setForm({ ...form, bymModel: v })}
                                            />
                                            <ModelConfigItem
                                                label="绘图模型"
                                                desc="图像生成"
                                                value={form.imageGenModel}
                                                models={allModels}
                                                onChange={v => setForm({ ...form, imageGenModel: v })}
                                            />
                                        </div>
                                    </div>

                                    {/* 知识库配置 */}
                                    {knowledgeBases.length > 0 && (
                                        <div className="space-y-3 border-t pt-4 mt-4">
                                            <div className="flex items-center gap-2">
                                                <Brain className="h-4 w-4 text-muted-foreground" />
                                                <Label>知识库</Label>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                为本群关联知识库，AI回复时可参考知识库内容
                                            </p>
                                            <div className="space-y-2">
                                                {knowledgeBases.map(kb => (
                                                    <div
                                                        key={kb.id}
                                                        className="flex items-center gap-2 p-2 rounded border bg-card"
                                                    >
                                                        <Switch
                                                            checked={form.knowledgeIds.includes(kb.id)}
                                                            onCheckedChange={checked => {
                                                                if (checked) {
                                                                    setForm({
                                                                        ...form,
                                                                        knowledgeIds: [...form.knowledgeIds, kb.id]
                                                                    })
                                                                } else {
                                                                    setForm({
                                                                        ...form,
                                                                        knowledgeIds: form.knowledgeIds.filter(
                                                                            id => id !== kb.id
                                                                        )
                                                                    })
                                                                }
                                                            }}
                                                        />
                                                        <span className="text-sm">{kb.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* 其他高级设置提示 */}
                                    <div className="border-t pt-4 mt-4">
                                        <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                                            <p>💡 更多高级设置（如MCP服务、工具组配置等）请在主管理面板中配置</p>
                                        </div>
                                    </div>
                                </TabsContent>
                            </ScrollArea>
                        </Tabs>
                    </CardContent>
                </Card>

                <div className="mt-6 text-center text-sm text-gray-500">
                    <p>ChatGPT Plugin 群管理面板 · 群 {groupId}</p>
                </div>
            </div>

            {/* 表情大图预览对话框 */}
            <Dialog open={!!viewEmoji} onOpenChange={v => !v && setViewEmoji(null)}>
                <DialogContent className="max-w-sm sm:max-w-md p-0 overflow-hidden bg-transparent border-none shadow-none">
                    {viewEmoji && (
                        <div className="relative group">
                            <img src={viewEmoji.url} alt={viewEmoji.name} className="w-full h-auto rounded-lg shadow-2xl bg-background/10 backdrop-blur-sm" />
                            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="secondary" size="sm" onClick={() => deleteEmoji(viewEmoji.name)}>
                                    <Trash2 className="h-4 w-4 mr-1" /> 删除
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setViewEmoji(null)}>
                                    关闭
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 渠道编辑对话框 */}
            <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editingChannelIndex !== null ? '编辑渠道' : '添加渠道'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>渠道名称</Label>
                            <Input
                                value={channelForm.name}
                                onChange={e => setChannelForm({ ...channelForm, name: e.target.value })}
                                placeholder="例如：OpenAI-1"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Base URL</Label>
                            <Input
                                value={channelForm.baseUrl}
                                onChange={e => setChannelForm({ ...channelForm, baseUrl: e.target.value })}
                                placeholder="https://api.openai.com/v1"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>API Key</Label>
                            <Input
                                type="password"
                                value={channelForm.apiKey}
                                onChange={e => setChannelForm({ ...channelForm, apiKey: e.target.value })}
                                placeholder="sk-..."
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>适配器类型</Label>
                                <Select
                                    value={channelForm.adapterType}
                                    onValueChange={v => setChannelForm({ ...channelForm, adapterType: v })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="openai">OpenAI</SelectItem>
                                        <SelectItem value="azure">Azure</SelectItem>
                                        <SelectItem value="claude">Claude</SelectItem>
                                        <SelectItem value="gemini">Gemini</SelectItem>
                                        <SelectItem value="ollama">Ollama</SelectItem>
                                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>权重 (优先级)</Label>
                                <Input
                                    type="number"
                                    value={channelForm.priority}
                                    onChange={e => setChannelForm({ ...channelForm, priority: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>可用模型 (逗号分隔)</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={channelForm.models}
                                    onChange={e => setChannelForm({ ...channelForm, models: e.target.value })}
                                    placeholder="gpt-4o,gpt-4-turbo..."
                                    className="flex-1"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={async () => {
                                        if (!channelForm.baseUrl || !channelForm.apiKey) {
                                            toast.error('请先填写 Base URL 和 API Key')
                                            return
                                        }
                                        setFetchingModels(true)
                                        try {
                                            const res = await fetch('/api/admin/models/fetch', {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                    Authorization: `Bearer ${getToken()}`
                                                },
                                                body: JSON.stringify({
                                                    baseUrl: channelForm.baseUrl,
                                                    apiKey: channelForm.apiKey,
                                                    adapterType: channelForm.adapterType
                                                })
                                            })
                                            const data = await res.json()
                                            if (data.code === 0) {
                                                setAvailableModels(data.data)
                                                setSelectedModels(channelForm.models.split(',').filter(Boolean))
                                                setModelSelectorOpen(true)
                                            } else {
                                                toast.error(data.message || '获取失败')
                                            }
                                        } catch (err: any) {
                                            toast.error(err.message)
                                        } finally {
                                            setFetchingModels(false)
                                        }
                                    }}
                                    disabled={fetchingModels}
                                >
                                    {fetchingModels ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* 高级配置 */}
                        <div className="border-t pt-4">
                            <Label className="mb-2 block">高级配置</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">模型列表路径</Label>
                                    <Input
                                        value={channelForm.modelsPath}
                                        onChange={e => setChannelForm({ ...channelForm, modelsPath: e.target.value })}
                                        placeholder="data"
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">聊天接口路径</Label>
                                    <Input
                                        value={channelForm.chatPath}
                                        onChange={e => setChannelForm({ ...channelForm, chatPath: e.target.value })}
                                        placeholder="/chat/completions"
                                        className="h-8 text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 图片处理配置 */}
                        <div className="border-t pt-4">
                            <Label className="mb-2 block">图片处理</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">传输模式</Label>
                                    <Select
                                        value={channelForm.imageTransferMode}
                                        onValueChange={(v: any) => setChannelForm({ ...channelForm, imageTransferMode: v })}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="auto">自动 (Auto)</SelectItem>
                                            <SelectItem value="base64">Base64</SelectItem>
                                            <SelectItem value="url">URL链接</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">压缩图片</Label>
                                    <div className="flex items-center gap-2 h-8">
                                        <Switch
                                            checked={channelForm.imageCompress}
                                            onCheckedChange={v => setChannelForm({ ...channelForm, imageCompress: v })}
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {channelForm.imageCompress ? '开启' : '关闭'}
                                        </span>
                                    </div>
                                </div>
                                {channelForm.imageCompress && (
                                    <>
                                        <div className="space-y-2">
                                            <Label className="text-xs">质量 (1-100)</Label>
                                            <Input
                                                type="number"
                                                value={channelForm.imageQuality}
                                                onChange={e => setChannelForm({ ...channelForm, imageQuality: parseInt(e.target.value) || 85 })}
                                                min={1}
                                                max={100}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">最大尺寸 (px)</Label>
                                            <Input
                                                type="number"
                                                value={channelForm.imageMaxSize}
                                                onChange={e => setChannelForm({ ...channelForm, imageMaxSize: parseInt(e.target.value) || 4096 })}
                                                min={100}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 pt-2">
                            <Switch
                                checked={channelForm.enabled}
                                onCheckedChange={v => setChannelForm({ ...channelForm, enabled: v })}
                            />
                            <Label>启用此渠道</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setChannelDialogOpen(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={() => {
                                if (!channelForm.name || !channelForm.baseUrl || !channelForm.apiKey) {
                                    toast.error('请填写必要信息')
                                    return
                                }
                                const newChannel: IndependentChannel = {
                                    id: editingChannelIndex !== null
                                        ? form.independentChannels[editingChannelIndex].id
                                        : Math.random().toString(36).substring(7),
                                    name: channelForm.name,
                                    baseUrl: channelForm.baseUrl,
                                    apiKey: channelForm.apiKey,
                                    adapterType: channelForm.adapterType,
                                    models: channelForm.models.split(',').filter(Boolean),
                                    enabled: channelForm.enabled,
                                    priority: channelForm.priority,
                                    modelsPath: channelForm.modelsPath || undefined,
                                    chatPath: channelForm.chatPath || undefined,
                                    imageConfig: {
                                        transferMode: channelForm.imageTransferMode,
                                        compress: channelForm.imageCompress,
                                        quality: channelForm.imageQuality,
                                        maxSize: channelForm.imageMaxSize
                                    }
                                }
                                const newChannels = [...form.independentChannels]
                                if (editingChannelIndex !== null) {
                                    newChannels[editingChannelIndex] = newChannel
                                } else {
                                    newChannels.push(newChannel)
                                }
                                setForm({ ...form, independentChannels: newChannels })
                                setChannelDialogOpen(false)
                            }}
                        >
                            {editingChannelIndex !== null ? '更新' : '添加'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 模型选择器 */}
            <Dialog open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>选择模型</DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-2">
                            {availableModels.map(model => (
                                <div key={model} className="flex items-center gap-2">
                                    <Checkbox
                                        checked={selectedModels.includes(model)}
                                        onCheckedChange={checked => {
                                            if (checked) {
                                                setSelectedModels([...selectedModels, model])
                                            } else {
                                                setSelectedModels(selectedModels.filter(m => m !== model))
                                            }
                                        }}
                                    />
                                    <Label className="text-sm font-normal">{model}</Label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModelSelectorOpen(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={() => {
                                setChannelForm({ ...channelForm, models: selectedModels.join(',') })
                                setModelSelectorOpen(false)
                            }}
                        >
                            确认
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function FeatureItem({
    icon,
    title,
    desc,
    value,
    onChange
}: {
    icon: React.ReactNode
    title: string
    desc: string
    value: 'inherit' | 'on' | 'off'
    onChange: (v: 'inherit' | 'on' | 'off') => void
}) {
    return (
        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted">{icon}</div>
                <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
            </div>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="w-28">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="inherit">继承</SelectItem>
                    <SelectItem value="on">开启</SelectItem>
                    <SelectItem value="off">关闭</SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}

function ModelSubSelect({
    label,
    value,
    models,
    onChange
}: {
    label: string
    value: string
    models: string[]
    onChange: (v: string) => void
}) {
    return (
        <div className="ml-4 pl-4 border-l-2 border-muted space-y-2">
            <Label className="text-xs">{label}</Label>
            <Select value={value || '__default__'} onValueChange={v => onChange(v === '__default__' ? '' : v)}>
                <SelectTrigger>
                    <SelectValue placeholder="继承全局" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="__default__">继承全局</SelectItem>
                    {models.map(m => (
                        <SelectItem key={m} value={m}>
                            {m}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}

function ModelConfigItem({
    label,
    desc,
    value,
    models,
    onChange
}: {
    label: string
    desc: string
    value: string
    models: string[]
    onChange: (v: string) => void
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">
                {label} <span className="text-muted-foreground">（{desc}）</span>
            </Label>
            <Select value={value || '__default__'} onValueChange={v => onChange(v === '__default__' ? '' : v)}>
                <SelectTrigger>
                    <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                    <SelectItem value="__default__">使用全局配置</SelectItem>
                    {models.map(m => (
                        <SelectItem key={m} value={m}>
                            {m}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
