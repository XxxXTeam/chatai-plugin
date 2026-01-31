'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
    AlertCircle, Loader2, Settings, Zap, Sparkles, BookOpen, RefreshCw, Power, X, Image,
    MessageSquare, PartyPopper, Palette, Bot, Users, Clock, Hand, UserPlus, UserMinus,
    Brain, Smile, Server, Trash2, Plus, Eye, EyeOff
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { ChannelDialog, ChannelFormData } from '@/components/group-editor/ChannelDialog'

// ============== 类型定义 ==============
interface IndependentChannel {
    id: string
    name: string
    baseUrl: string
    apiKey: string
    adapterType: string
    models: string[]
    enabled: boolean
    priority: number
    modelsPath?: string
    chatPath?: string
    imageConfig?: {
        transferMode?: 'base64' | 'url' | 'auto'
        compress?: boolean
        quality?: number
        maxSize?: number
    }
}

interface Preset {
    id: string
    name: string
    description?: string
    systemPromptPreview?: string
}

type TriState = 'inherit' | 'on' | 'off'
type TabId = 'basic' | 'features' | 'bym' | 'channel' | 'advanced'

// ============== 子组件 ==============

// 三态开关
function TriStateSelect({ value, onChange, className }: {
    value: TriState
    onChange: (v: TriState) => void
    className?: string
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className={cn('w-24', className)}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="inherit">继承</SelectItem>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
            </SelectContent>
        </Select>
    )
}

// 功能项
function FeatureItem({ icon, title, desc, value, onChange, children }: {
    icon: React.ReactNode
    title: string
    desc: string
    value: TriState
    onChange: (v: TriState) => void
    children?: React.ReactNode
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-md bg-muted shrink-0">{icon}</div>
                    <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{title}</p>
                        <p className="text-xs text-muted-foreground truncate">{desc}</p>
                    </div>
                </div>
                <TriStateSelect value={value} onChange={onChange} />
            </div>
            {children && value !== 'off' && (
                <div className="ml-4 pl-4 border-l-2 border-muted space-y-3">
                    {children}
                </div>
            )}
        </div>
    )
}

// 模型选择
function ModelSelect({ label, value, models, onChange }: {
    label: string
    value: string
    models: string[]
    onChange: (v: string) => void
}) {
    return (
        <div className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Select value={value || '__default__'} onValueChange={v => onChange(v === '__default__' ? '' : v)}>
                <SelectTrigger>
                    <SelectValue placeholder="继承全局" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="__default__">继承全局</SelectItem>
                    {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    )
}

// 概率滑块
function ProbabilitySlider({ value, onChange, label = '响应概率' }: {
    value: number | 'inherit'
    onChange: (v: number) => void
    label?: string
}) {
    const numValue = value === 'inherit' ? 1 : value
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <span className="text-xs text-muted-foreground">{Math.round(numValue * 100)}%</span>
            </div>
            <Slider value={[numValue]} onValueChange={([v]) => onChange(v)} min={0} max={1} step={0.05} />
        </div>
    )
}

// ============== 主组件 ==============
export default function GroupAdminPage() {
    const isMobile = useIsMobile()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [groupId, setGroupId] = useState('')
    const [error, setError] = useState('')
    const [activeTab, setActiveTab] = useState<TabId>('basic')

    // 登录状态
    const [needLogin, setNeedLogin] = useState(false)
    const [loginCode, setLoginCode] = useState('')
    const [loginLoading, setLoginLoading] = useState(false)

    // 数据
    const [presets, setPresets] = useState<Preset[]>([])
    const [allModels, setAllModels] = useState<string[]>([])
    const [knowledgeBases, setKnowledgeBases] = useState<{ id: string; name: string }[]>([])
    const [emojiStats, setEmojiStats] = useState<{ total: number; images: { name: string; url: string }[] }>({ total: 0, images: [] })

    // 表单状态
    const [form, setForm] = useState({
        groupId: '', groupName: '', presetId: '__default__', systemPrompt: '', enabled: true,
        triggerMode: 'default', customPrefix: '',
        // 功能开关
        toolsEnabled: 'inherit' as TriState, imageGenEnabled: 'inherit' as TriState,
        imageGenModel: '', imageGenSize: '1024x1024', imageGenQuality: 'standard', imageGenDailyLimit: 0,
        summaryEnabled: 'inherit' as TriState, summaryModel: '', eventEnabled: 'inherit' as TriState,
        // 表情小偷
        emojiThiefEnabled: 'inherit' as TriState, emojiThiefSeparateFolder: true, emojiThiefMaxCount: 500,
        emojiThiefStealRate: 1.0, emojiThiefTriggerRate: 0.05,
        emojiThiefTriggerMode: 'off' as 'off' | 'chat_follow' | 'chat_random' | 'bym_follow' | 'bym_random',
        // 伪人
        bymEnabled: 'inherit' as TriState, bymPresetId: '__default__', bymPrompt: '',
        bymProbability: 'inherit' as 'inherit' | number, bymModel: '',
        bymTemperature: 'inherit' as 'inherit' | number, bymMaxTokens: 'inherit' as 'inherit' | number,
        bymReplyLength: 'medium', bymUseEmoji: true,
        // 主动发言
        proactiveChatEnabled: 'inherit' as TriState,
        proactiveChatProbability: 'inherit' as 'inherit' | number,
        proactiveChatCooldown: 'inherit' as 'inherit' | number,
        proactiveChatMaxDaily: 'inherit' as 'inherit' | number,
        proactiveChatMinMessages: 5, proactiveChatTimeStart: 8, proactiveChatTimeEnd: 23,
        // 聊天
        chatEnabled: true, chatContextLength: 20, chatStreamReply: true,
        chatQuoteReply: false, chatShowThinking: true, chatModel: '',
        // 名单
        listMode: 'none', blacklist: [] as string[], whitelist: [] as string[],
        // 总结推送
        summaryPushEnabled: false, summaryPushIntervalType: 'day' as 'day' | 'hour',
        summaryPushIntervalValue: 1, summaryPushHour: 20, summaryPushMessageCount: 100,
        // 事件
        welcomeEnabled: 'inherit' as TriState, welcomeMessage: '', welcomePrompt: '',
        welcomeProbability: 'inherit' as 'inherit' | number,
        goodbyeEnabled: 'inherit' as TriState, goodbyePrompt: '',
        goodbyeProbability: 'inherit' as 'inherit' | number,
        pokeEnabled: 'inherit' as TriState, pokeBack: false, pokeProbability: 'inherit' as 'inherit' | number,
        recallEnabled: 'inherit' as TriState, recallProbability: 'inherit' as 'inherit' | number,
        banEnabled: 'inherit' as TriState, banProbability: 'inherit' as 'inherit' | number,
        luckyKingEnabled: 'inherit' as TriState, luckyKingProbability: 'inherit' as 'inherit' | number,
        honorEnabled: 'inherit' as TriState, honorProbability: 'inherit' as 'inherit' | number,
        essenceEnabled: 'inherit' as TriState, essenceProbability: 'inherit' as 'inherit' | number,
        adminEnabled: 'inherit' as TriState, adminProbability: 'inherit' as 'inherit' | number,
        // 知识库
        knowledgeIds: [] as string[],
        // 渠道
        independentChannelEnabled: false, independentBaseUrl: '', independentApiKey: '',
        independentAdapterType: 'openai',
        independentChannels: [] as IndependentChannel[],
        // 限制
        dailyGroupLimit: 0, dailyUserLimit: 0, usageLimitMessage: ''
    })

    // 渠道编辑
    const [channelDialogOpen, setChannelDialogOpen] = useState(false)
    const [editingChannelIndex, setEditingChannelIndex] = useState<number | null>(null)
    const [channelForm, setChannelForm] = useState<ChannelFormData>({
        name: '', baseUrl: '', apiKey: '', adapterType: 'openai', models: '',
        enabled: true, priority: 0, modelsPath: '', chatPath: '',
        imageTransferMode: 'auto',
        imageCompress: true, imageQuality: 85, imageMaxSize: 4096
    })
    const [viewEmoji, setViewEmoji] = useState<{ name: string; url: string } | null>(null)

    const getToken = () => localStorage.getItem('group_admin_token') || ''

    const handleLoginWithCode = useCallback(async (code: string) => {
        setLoading(true)
        try {
            const res = await fetch('/chatai/api/group-admin/login', {
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
        } catch {
            toast.error('登录失败，请检查网络')
            setNeedLogin(true)
            setLoading(false)
        }
    }, [])

    const loadConfig = useCallback(async (token?: string) => {
        try {
            const res = await fetch('/chatai/api/group-admin/config', {
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
                const c = data.data
                setGroupId(c.groupId)
                setPresets(c.presets || [])
                
                const models = new Set<string>()
                c.channels?.forEach((ch: { models?: string[] }) => {
                    ch.models?.forEach(m => models.add(m))
                })
                setAllModels(Array.from(models).sort())
                if (c.knowledgeBases) setKnowledgeBases(c.knowledgeBases)
                if (c.emojiStats) setEmojiStats(c.emojiStats)

                // 转换并设置表单
                setForm(prev => ({
                    ...prev,
                    groupId: c.groupId,
                    groupName: c.groupName || '',
                    presetId: c.presetId || '__default__',
                    systemPrompt: c.systemPrompt || '',
                    enabled: c.enabled !== false,
                    triggerMode: c.triggerMode || 'default',
                    customPrefix: c.customPrefix || '',
                    toolsEnabled: c.toolsEnabled === undefined ? 'inherit' : c.toolsEnabled ? 'on' : 'off',
                    imageGenEnabled: c.imageGenEnabled === undefined ? 'inherit' : c.imageGenEnabled ? 'on' : 'off',
                    imageGenModel: c.models?.image || '',
                    summaryEnabled: c.summaryEnabled === undefined ? 'inherit' : c.summaryEnabled ? 'on' : 'off',
                    summaryModel: c.models?.summary || '',
                    eventEnabled: c.eventHandler === undefined ? 'inherit' : c.eventHandler ? 'on' : 'off',
                    emojiThiefEnabled: c.emojiThief?.enabled === undefined ? 'inherit' : c.emojiThief.enabled ? 'on' : 'off',
                    emojiThiefSeparateFolder: c.emojiThief?.independent ?? true,
                    emojiThiefMaxCount: c.emojiThief?.maxCount ?? 500,
                    emojiThiefStealRate: (c.emojiThief?.probability ?? 100) / 100,
                    emojiThiefTriggerRate: (c.emojiThief?.triggerRate ?? 5) / 100,
                    emojiThiefTriggerMode: c.emojiThief?.triggerMode || 'off',
                    bymEnabled: c.bym?.enabled === undefined ? 'inherit' : c.bym.enabled ? 'on' : 'off',
                    bymPresetId: c.bym?.presetId || '__default__',
                    bymPrompt: c.bym?.prompt || '',
                    bymProbability: c.bym?.probability ?? 'inherit',
                    bymModel: c.bym?.modelId || '',
                    bymTemperature: c.bym?.temperature ?? 'inherit',
                    bymMaxTokens: c.bym?.maxTokens ?? 'inherit',
                    bymReplyLength: c.bym?.style?.replyLength || 'medium',
                    bymUseEmoji: c.bym?.style?.useEmoji ?? true,
                    proactiveChatEnabled: c.bym?.proactive?.enabled === undefined ? 'inherit' : c.bym.proactive.enabled ? 'on' : 'off',
                    proactiveChatProbability: c.bym?.proactive?.probability ?? 'inherit',
                    proactiveChatCooldown: c.bym?.proactive?.cooldown ?? 'inherit',
                    proactiveChatMaxDaily: c.bym?.proactive?.maxDaily ?? 'inherit',
                    proactiveChatMinMessages: c.bym?.proactive?.minMessages ?? 5,
                    proactiveChatTimeStart: c.bym?.proactive?.timeRange?.start ?? 8,
                    proactiveChatTimeEnd: c.bym?.proactive?.timeRange?.end ?? 23,
                    chatEnabled: c.chat?.enabled ?? true,
                    chatContextLength: c.chat?.contextLength ?? 20,
                    chatStreamReply: c.chat?.streamReply ?? true,
                    chatQuoteReply: c.chat?.quoteReply ?? false,
                    chatShowThinking: c.chat?.showThinking ?? true,
                    chatModel: c.models?.chat || '',
                    listMode: c.listMode || 'none',
                    blacklist: c.blacklist || [],
                    whitelist: c.whitelist || [],
                    summaryPushEnabled: c.summary?.push?.enabled || false,
                    summaryPushIntervalType: c.summary?.push?.intervalType || 'day',
                    summaryPushIntervalValue: c.summary?.push?.intervalValue || 1,
                    summaryPushHour: c.summary?.push?.pushHour ?? 20,
                    summaryPushMessageCount: c.summary?.push?.messageCount || 100,
                    welcomeEnabled: c.events?.welcome?.enabled === undefined ? 'inherit' : c.events.welcome.enabled ? 'on' : 'off',
                    welcomeMessage: c.events?.welcome?.message || '',
                    welcomePrompt: c.events?.welcome?.prompt || '',
                    welcomeProbability: c.events?.welcome?.probability ?? 'inherit',
                    goodbyeEnabled: c.events?.goodbye?.enabled === undefined ? 'inherit' : c.events.goodbye.enabled ? 'on' : 'off',
                    goodbyePrompt: c.events?.goodbye?.prompt || '',
                    goodbyeProbability: c.events?.goodbye?.probability ?? 'inherit',
                    pokeEnabled: c.events?.poke?.enabled === undefined ? 'inherit' : c.events.poke.enabled ? 'on' : 'off',
                    pokeBack: c.events?.poke?.pokeBack || false,
                    pokeProbability: c.events?.poke?.probability ?? 'inherit',
                    recallEnabled: c.events?.recall?.enabled === undefined ? 'inherit' : c.events.recall.enabled ? 'on' : 'off',
                    recallProbability: c.events?.recall?.probability ?? 'inherit',
                    banEnabled: c.events?.ban?.enabled === undefined ? 'inherit' : c.events.ban.enabled ? 'on' : 'off',
                    banProbability: c.events?.ban?.probability ?? 'inherit',
                    luckyKingEnabled: c.events?.luckyKing?.enabled === undefined ? 'inherit' : c.events.luckyKing.enabled ? 'on' : 'off',
                    luckyKingProbability: c.events?.luckyKing?.probability ?? 'inherit',
                    honorEnabled: c.events?.honor?.enabled === undefined ? 'inherit' : c.events.honor.enabled ? 'on' : 'off',
                    honorProbability: c.events?.honor?.probability ?? 'inherit',
                    essenceEnabled: c.events?.essence?.enabled === undefined ? 'inherit' : c.events.essence.enabled ? 'on' : 'off',
                    essenceProbability: c.events?.essence?.probability ?? 'inherit',
                    adminEnabled: c.events?.admin?.enabled === undefined ? 'inherit' : c.events.admin.enabled ? 'on' : 'off',
                    adminProbability: c.events?.admin?.probability ?? 'inherit',
                    knowledgeIds: c.knowledgeIds || [],
                    imageGenSize: c.imageGen?.size || '1024x1024',
                    imageGenQuality: c.imageGen?.quality || 'standard',
                    imageGenDailyLimit: c.imageGen?.maxDailyLimit ?? 0,
                    independentChannelEnabled: c.independentChannel?.hasChannel || false,
                    independentBaseUrl: c.independentChannel?.baseUrl || '',
                    independentApiKey: c.independentChannel?.apiKey || '',
                    independentAdapterType: c.independentChannel?.adapterType || 'openai',
                    // forbidGlobalModel 由主管理面板配置，群管理面板不能修改
                    independentChannels: c.independentChannel?.channels || [],
                    dailyGroupLimit: c.usageLimit?.dailyGroupLimit || 0,
                    dailyUserLimit: c.usageLimit?.dailyUserLimit || 0,
                    usageLimitMessage: c.usageLimit?.limitMessage || ''
                }))
            }
        } catch (err: unknown) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search)
        const urlCode = urlParams.get('code')
        if (urlCode) {
            window.history.replaceState({}, '', '/group-admin')
            handleLoginWithCode(urlCode)
            return
        }
        const token = localStorage.getItem('group_admin_token')
        if (!token) {
            setNeedLogin(true)
            setLoading(false)
            return
        }
        loadConfig(token)
    }, [handleLoginWithCode, loadConfig])

    const handleLogin = async () => {
        if (!loginCode.trim()) {
            toast.error('请输入登录码')
            return
        }
        setLoginLoading(true)
        try {
            const res = await fetch('/chatai/api/group-admin/login', {
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
        } catch {
            toast.error('登录失败')
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

    const saveConfig = async () => {
        setSaving(true)
        try {
            const res = await fetch('/chatai/api/group-admin/config', {
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
                            timeRange: { start: form.proactiveChatTimeStart, end: form.proactiveChatTimeEnd }
                        },
                        style: { replyLength: form.bymReplyLength, useEmoji: form.bymUseEmoji }
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
                    models: { chat: form.chatModel || undefined, summary: form.summaryModel || undefined },
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
                        recall: { enabled: form.recallEnabled === 'inherit' ? undefined : form.recallEnabled === 'on', probability: form.recallProbability === 'inherit' ? undefined : form.recallProbability },
                        ban: { enabled: form.banEnabled === 'inherit' ? undefined : form.banEnabled === 'on', probability: form.banProbability === 'inherit' ? undefined : form.banProbability },
                        luckyKing: { enabled: form.luckyKingEnabled === 'inherit' ? undefined : form.luckyKingEnabled === 'on', probability: form.luckyKingProbability === 'inherit' ? undefined : form.luckyKingProbability },
                        honor: { enabled: form.honorEnabled === 'inherit' ? undefined : form.honorEnabled === 'on', probability: form.honorProbability === 'inherit' ? undefined : form.honorProbability },
                        essence: { enabled: form.essenceEnabled === 'inherit' ? undefined : form.essenceEnabled === 'on', probability: form.essenceProbability === 'inherit' ? undefined : form.essenceProbability },
                        admin: { enabled: form.adminEnabled === 'inherit' ? undefined : form.adminEnabled === 'on', probability: form.adminProbability === 'inherit' ? undefined : form.adminProbability }
                    },
                    independentChannel: {
                        baseUrl: form.independentBaseUrl || undefined,
                        apiKey: form.independentApiKey || undefined,
                        adapterType: form.independentAdapterType,
                        // forbidGlobal 由主管理面板配置，群管理面板不能修改
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
                if (res.status === 401) { setError('认证已过期'); return }
                throw new Error('保存失败')
            }
            const data = await res.json()
            if (data.code === 0) toast.success('配置已保存')
            else throw new Error(data.message || '保存失败')
        } catch (err: unknown) {
            toast.error((err as Error).message)
        } finally {
            setSaving(false)
        }
    }

    const deleteEmoji = async (fileName: string) => {
        if (!confirm('确定要删除这个表情吗？')) return
        try {
            const res = await fetch(`/chatai/api/group-admin/emoji/delete?file=${encodeURIComponent(fileName)}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (res.ok) {
                toast.success('已删除')
                setEmojiStats({ ...emojiStats, total: emojiStats.total - 1, images: emojiStats.images.filter(img => img.name !== fileName) })
            }
        } catch { toast.error('删除失败') }
    }

    const clearEmojis = async () => {
        if (!confirm('确定要清空所有表情吗？')) return
        try {
            const res = await fetch('/chatai/api/group-admin/emoji/clear', {
                method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (res.ok) { toast.success('已清空'); setEmojiStats({ total: 0, images: [] }) }
        } catch { toast.error('清空失败') }
    }

    // Tab 配置
    const tabs: { id: TabId; label: string; mobileLabel: string; icon: React.ReactNode }[] = [
        { id: 'basic', label: '基础设置', mobileLabel: '基础', icon: <Settings className="h-4 w-4" /> },
        { id: 'features', label: '功能开关', mobileLabel: '功能', icon: <Zap className="h-4 w-4" /> },
        { id: 'bym', label: '伪人模式', mobileLabel: '伪人', icon: <Sparkles className="h-4 w-4" /> },
        { id: 'channel', label: '对话设置', mobileLabel: '对话', icon: <MessageSquare className="h-4 w-4" /> },
        { id: 'advanced', label: '高级配置', mobileLabel: '高级', icon: <BookOpen className="h-4 w-4" /> }
    ]

    // ============== 渲染 ==============
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (needLogin) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-orange-50/30 dark:via-orange-950/10 to-muted">
                <div className="w-full max-w-md space-y-4">
                    <Card className="border-orange-200/50 dark:border-orange-900/30">
                        <CardContent className="p-6">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Users className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                                </div>
                                <h2 className="text-xl font-semibold">群管理面板</h2>
                                <p className="text-sm text-muted-foreground mt-1">专属于群管理员的配置入口</p>
                            </div>
                            <div className="space-y-4">
                                <Input
                                    value={loginCode}
                                    onChange={e => setLoginCode(e.target.value.toUpperCase())}
                                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                                    placeholder="输入6位登录码"
                                    maxLength={6}
                                    className="text-center text-xl tracking-wider font-mono h-12 border-orange-200 dark:border-orange-900/50 focus-visible:ring-orange-500"
                                    autoFocus
                                />
                                <Button className="w-full h-11 bg-orange-600 hover:bg-orange-700" onClick={handleLogin} disabled={loginLoading}>
                                    {loginLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    登录管理面板
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 使用说明 */}
                    <Card className="bg-muted/50">
                        <CardContent className="p-4 space-y-3">
                            <h3 className="font-medium text-sm flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-orange-600" />
                                如何获取登录码？
                            </h3>
                            <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                                <li>确保您是目标群的 <strong>管理员</strong> 或 <strong>群主</strong></li>
                                <li>在群内发送命令 <code className="bg-background px-1.5 py-0.5 rounded border">#群管理面板</code></li>
                                <li>Bot 将私聊发送登录码或直接链接</li>
                                <li>登录码有效期为 <strong>5分钟</strong>，请尽快使用</li>
                            </ol>
                        </CardContent>
                    </Card>

                    {/* 功能说明 */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-2 bg-card p-2.5 rounded-lg border">
                            <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">设置群专属人设</span>
                        </div>
                        <div className="flex items-center gap-2 bg-card p-2.5 rounded-lg border">
                            <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">管理功能开关</span>
                        </div>
                        <div className="flex items-center gap-2 bg-card p-2.5 rounded-lg border">
                            <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">配置伪人模式</span>
                        </div>
                        <div className="flex items-center gap-2 bg-card p-2.5 rounded-lg border">
                            <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">独立渠道配置</span>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <Card className="w-full max-w-sm">
                    <CardContent className="pt-6 text-center">
                        <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
                        <h2 className="mt-4 text-xl font-semibold">{error}</h2>
                        <p className="mt-2 text-sm text-muted-foreground">请在群内发送 #群管理面板 重新获取登录码</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* 顶部 */}
            <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b shrink-0">
                <div className="container max-w-4xl mx-auto px-4">
                    <div className="flex items-center justify-between h-14">
                        <div className="min-w-0">
                            <h1 className="font-semibold truncate">{form.groupName || `群 ${groupId}`}</h1>
                            <p className="text-xs text-muted-foreground font-mono">#{groupId}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" onClick={() => loadConfig()} disabled={saving} className="h-9 w-9">
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button onClick={saveConfig} disabled={saving} size="sm" className="h-9">
                                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                                <span className="hidden sm:inline">保存</span>
                                <span className="sm:hidden">存</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleLogout} className="h-9">退出</Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* 主内容 */}
            <main className="flex-1 overflow-y-auto">
                <div className="container max-w-4xl mx-auto px-4 py-4 pb-20 sm:pb-4">
                {/* 桌面端 Tab */}
                {!isMobile && (
                    <div className="flex gap-1 p-1 bg-muted rounded-lg mb-4 overflow-x-auto">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                                    activeTab === tab.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}

                    <Card>
                        <CardContent className="p-4 sm:p-6">
                            {/* 基础设置 Tab */}
                            {activeTab === 'basic' && (
                                <div className="space-y-4">
                                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>群号</Label>
                                            <Input value={form.groupId} disabled />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>群名称</Label>
                                            <Input value={form.groupName} onChange={e => setForm({ ...form, groupName: e.target.value })} placeholder="可选" />
                                        </div>
                                    </div>
                                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>使用预设</Label>
                                            <Select value={form.presetId} onValueChange={v => setForm({ ...form, presetId: v })}>
                                                <SelectTrigger><SelectValue placeholder="选择预设" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__default__">使用默认预设</SelectItem>
                                                    {presets.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>触发模式</Label>
                                            <Select value={form.triggerMode} onValueChange={v => setForm({ ...form, triggerMode: v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
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
                                        <Input value={form.customPrefix} onChange={e => setForm({ ...form, customPrefix: e.target.value })} placeholder="留空使用全局前缀" />
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
                                        <p className="text-xs text-muted-foreground">支持变量: {'{{user_name}}'} {'{{group_name}}'} {'{{date}}'}</p>
                                    </div>
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                        <div className="flex items-center gap-2">
                                            <Power className="h-4 w-4" />
                                            <Label>启用AI响应</Label>
                                        </div>
                                        <Switch checked={form.enabled} onCheckedChange={v => setForm({ ...form, enabled: v })} />
                                    </div>
                                </div>
                            )}

                            {/* 功能开关 Tab */}
                            {activeTab === 'features' && (
                                <div className="space-y-3">
                                    <p className="text-xs text-muted-foreground mb-2">群管理员也可通过命令控制这些功能</p>
                                    
                                    <FeatureItem icon={<Zap className="h-4 w-4" />} title="工具调用" desc="搜索、代码执行等" value={form.toolsEnabled} onChange={v => setForm({ ...form, toolsEnabled: v })} />
                                    
                                    <FeatureItem icon={<Image className="h-4 w-4" />} title="绘图功能" desc="文生图、图生图" value={form.imageGenEnabled} onChange={v => setForm({ ...form, imageGenEnabled: v })}>
                                        <ModelSelect label="绘图模型" value={form.imageGenModel} models={allModels} onChange={v => setForm({ ...form, imageGenModel: v })} />
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">图片尺寸</Label>
                                                <Select value={form.imageGenSize} onValueChange={v => setForm({ ...form, imageGenSize: v })}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="1024x1024">1024x1024</SelectItem>
                                                        <SelectItem value="1792x1024">1792x1024</SelectItem>
                                                        <SelectItem value="1024x1792">1024x1792</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">每日限额</Label>
                                                <Input type="number" min={0} value={form.imageGenDailyLimit} onChange={e => setForm({ ...form, imageGenDailyLimit: parseInt(e.target.value) || 0 })} />
                                            </div>
                                        </div>
                                    </FeatureItem>
                                    
                                    <FeatureItem icon={<MessageSquare className="h-4 w-4" />} title="群聊总结" desc="AI生成群聊总结" value={form.summaryEnabled} onChange={v => setForm({ ...form, summaryEnabled: v })}>
                                        <ModelSelect label="总结模型" value={form.summaryModel} models={allModels} onChange={v => setForm({ ...form, summaryModel: v })} />
                                    </FeatureItem>
                                    
                                    <FeatureItem icon={<PartyPopper className="h-4 w-4" />} title="事件处理" desc="入群欢迎、退群提醒" value={form.eventEnabled} onChange={v => setForm({ ...form, eventEnabled: v })}>
                                        {/* 入群欢迎 */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-green-500" /><Label className="text-sm">入群欢迎</Label></div>
                                                <TriStateSelect value={form.welcomeEnabled} onChange={v => setForm({ ...form, welcomeEnabled: v })} />
                                            </div>
                                            {form.welcomeEnabled === 'on' && (
                                                <div className="pl-6 space-y-2">
                                                    <ProbabilitySlider value={form.welcomeProbability} onChange={v => setForm({ ...form, welcomeProbability: v })} />
                                                    <Textarea value={form.welcomeMessage} onChange={e => setForm({ ...form, welcomeMessage: e.target.value })} placeholder="固定欢迎语（留空用AI）" rows={2} className="text-sm" />
                                                </div>
                                            )}
                                        </div>
                                        {/* 退群提醒 */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2"><UserMinus className="h-4 w-4 text-red-500" /><Label className="text-sm">退群提醒</Label></div>
                                                <TriStateSelect value={form.goodbyeEnabled} onChange={v => setForm({ ...form, goodbyeEnabled: v })} />
                                            </div>
                                            {form.goodbyeEnabled === 'on' && (
                                                <div className="pl-6 space-y-2">
                                                    <ProbabilitySlider value={form.goodbyeProbability} onChange={v => setForm({ ...form, goodbyeProbability: v })} />
                                                </div>
                                            )}
                                        </div>
                                        {/* 戳一戳 */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2"><Hand className="h-4 w-4 text-blue-500" /><Label className="text-sm">戳一戳</Label></div>
                                                <TriStateSelect value={form.pokeEnabled} onChange={v => setForm({ ...form, pokeEnabled: v })} />
                                            </div>
                                            {form.pokeEnabled === 'on' && (
                                                <div className="pl-6 space-y-2">
                                                    <ProbabilitySlider value={form.pokeProbability} onChange={v => setForm({ ...form, pokeProbability: v })} />
                                                    <div className="flex items-center gap-2">
                                                        <Switch checked={form.pokeBack} onCheckedChange={v => setForm({ ...form, pokeBack: v })} />
                                                        <Label className="text-xs">戳回去</Label>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </FeatureItem>

                                    <FeatureItem icon={<Palette className="h-4 w-4 text-pink-500" />} title="表情小偷" desc="收集并发送表情包" value={form.emojiThiefEnabled} onChange={v => setForm({ ...form, emojiThiefEnabled: v })}>
                                        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                                            <div>
                                                <Label className="text-sm font-medium">独立存储</Label>
                                                <p className="text-xs text-muted-foreground">本群表情不与其他群共享</p>
                                            </div>
                                            <Switch checked={form.emojiThiefSeparateFolder} onCheckedChange={v => setForm({ ...form, emojiThiefSeparateFolder: v })} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">最大数量</Label>
                                                <Input type="number" value={form.emojiThiefMaxCount} onChange={e => setForm({ ...form, emojiThiefMaxCount: parseInt(e.target.value) || 500 })} />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">收集概率(%)</Label>
                                                <Input type="number" value={Math.round(form.emojiThiefStealRate * 100)} onChange={e => setForm({ ...form, emojiThiefStealRate: parseInt(e.target.value) / 100 })} />
                                            </div>
                                        </div>
                                        {/* 表情库预览 */}
                                        <div className="p-3 rounded-lg border bg-card">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <Smile className="h-4 w-4 text-yellow-500" />
                                                    <span className="text-sm font-medium">表情库</span>
                                                    <Badge variant="secondary" className="text-[10px]">{emojiStats.total} 张</Badge>
                                                </div>
                                                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={clearEmojis}>
                                                    <Trash2 className="h-3 w-3 mr-1" /> 清空
                                                </Button>
                                            </div>
                                            {emojiStats.images.length > 0 ? (
                                                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-36 overflow-y-auto">
                                                    {emojiStats.images.slice(0, 12).map((img, idx) => (
                                                        <div key={idx} className="relative aspect-square rounded border bg-muted/50 overflow-hidden cursor-pointer" onClick={() => setViewEmoji(img)}>
                                                            <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-4 text-xs text-muted-foreground">暂无表情</div>
                                            )}
                                        </div>
                                    </FeatureItem>

                                    {/* 黑白名单 */}
                                    <div className="border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-md bg-muted"><Users className="h-4 w-4" /></div>
                                                <div>
                                                    <p className="text-sm font-medium">用户权限</p>
                                                    <p className="text-xs text-muted-foreground">黑白名单</p>
                                                </div>
                                            </div>
                                            <Select value={form.listMode} onValueChange={v => setForm({ ...form, listMode: v })}>
                                                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">不启用</SelectItem>
                                                    <SelectItem value="blacklist">黑名单</SelectItem>
                                                    <SelectItem value="whitelist">白名单</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {form.listMode !== 'none' && (
                                            <Textarea
                                                className="mt-2 font-mono"
                                                placeholder="每行一个QQ号"
                                                value={(form.listMode === 'blacklist' ? form.blacklist : form.whitelist).join('\n')}
                                                onChange={e => {
                                                    const list = e.target.value.split('\n').filter(Boolean)
                                                    setForm({ ...form, [form.listMode === 'blacklist' ? 'blacklist' : 'whitelist']: list })
                                                }}
                                            />
                                        )}
                                    </div>

                                    {/* 定时推送 */}
                                    <div className="border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-md bg-muted"><Clock className="h-4 w-4" /></div>
                                                <div>
                                                    <p className="text-sm font-medium">定时总结推送</p>
                                                    <p className="text-xs text-muted-foreground">定期推送群聊总结</p>
                                                </div>
                                            </div>
                                            <Switch checked={form.summaryPushEnabled} onCheckedChange={v => setForm({ ...form, summaryPushEnabled: v })} />
                                        </div>
                                        {form.summaryPushEnabled && (
                                            <div className="ml-4 pl-4 border-l-2 border-muted space-y-3 mt-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">间隔类型</Label>
                                                        <Select value={form.summaryPushIntervalType} onValueChange={(v: 'day' | 'hour') => setForm({ ...form, summaryPushIntervalType: v })}>
                                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="day">按天</SelectItem>
                                                                <SelectItem value="hour">按小时</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">间隔值</Label>
                                                        <Input type="number" min={1} value={form.summaryPushIntervalValue} onChange={e => setForm({ ...form, summaryPushIntervalValue: parseInt(e.target.value) || 1 })} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 伪人模式 Tab */}
                            {activeTab === 'bym' && (
                                <div className="space-y-4">
                                    <FeatureItem icon={<Sparkles className="h-4 w-4 text-purple-500" />} title="伪人模式" desc="随机回复，模拟真人聊天" value={form.bymEnabled} onChange={v => setForm({ ...form, bymEnabled: v })}>
                                        <div className="space-y-2">
                                            <Label>伪人人设</Label>
                                            <Select value={form.bymPresetId} onValueChange={v => setForm({ ...form, bymPresetId: v })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__default__">使用默认预设</SelectItem>
                                                    <SelectItem value="__custom__">自定义提示词</SelectItem>
                                                    {presets.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {form.bymPresetId === '__custom__' && (
                                            <div className="space-y-2">
                                                <Label>自定义提示词</Label>
                                                <Textarea value={form.bymPrompt} onChange={e => setForm({ ...form, bymPrompt: e.target.value })} placeholder="你是一个真实的群友..." rows={3} className="font-mono text-sm" />
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-sm">触发概率</Label>
                                                {form.bymProbability === 'inherit' ? (
                                                    <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({ ...form, bymProbability: 0.02 })}>继承全局</Button>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <Input type="number" min={0} max={100} className="w-20" value={Math.round((form.bymProbability as number) * 100)} onChange={e => setForm({ ...form, bymProbability: parseInt(e.target.value) / 100 })} />
                                                        <span className="text-sm">%</span>
                                                        <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, bymProbability: 'inherit' })}><X className="h-3 w-3" /></Button>
                                                    </div>
                                                )}
                                            </div>
                                            <ModelSelect label="伪人模型" value={form.bymModel} models={allModels} onChange={v => setForm({ ...form, bymModel: v })} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-sm">温度</Label>
                                                {form.bymTemperature === 'inherit' ? (
                                                    <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({ ...form, bymTemperature: 0.9 })}>继承全局</Button>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <Input type="number" min={0} max={2} step={0.1} value={form.bymTemperature} onChange={e => setForm({ ...form, bymTemperature: parseFloat(e.target.value) })} />
                                                        <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, bymTemperature: 'inherit' })}><X className="h-3 w-3" /></Button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-sm">最大Token</Label>
                                                {form.bymMaxTokens === 'inherit' ? (
                                                    <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({ ...form, bymMaxTokens: 100 })}>继承全局</Button>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <Input type="number" min={10} max={2000} value={form.bymMaxTokens} onChange={e => setForm({ ...form, bymMaxTokens: parseInt(e.target.value) })} />
                                                        <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, bymMaxTokens: 'inherit' })}><X className="h-3 w-3" /></Button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 主动发言 */}
                                        <div className="border-t pt-4 mt-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <MessageSquare className="h-4 w-4 text-green-500" />
                                                    <Label className="font-medium">主动发言</Label>
                                                </div>
                                                <TriStateSelect value={form.proactiveChatEnabled} onChange={v => setForm({ ...form, proactiveChatEnabled: v })} />
                                            </div>
                                            {form.proactiveChatEnabled !== 'off' && (
                                                <div className="space-y-3 ml-4 pl-4 border-l-2 border-muted">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">触发概率</Label>
                                                            <Select value={form.proactiveChatProbability === 'inherit' ? 'inherit' : String(form.proactiveChatProbability)} onValueChange={v => setForm({ ...form, proactiveChatProbability: v === 'inherit' ? 'inherit' : parseFloat(v) })}>
                                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="inherit">继承</SelectItem>
                                                                    <SelectItem value="0.02">2%</SelectItem>
                                                                    <SelectItem value="0.05">5%</SelectItem>
                                                                    <SelectItem value="0.1">10%</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">冷却(分钟)</Label>
                                                            <Select value={form.proactiveChatCooldown === 'inherit' ? 'inherit' : String(form.proactiveChatCooldown)} onValueChange={v => setForm({ ...form, proactiveChatCooldown: v === 'inherit' ? 'inherit' : parseInt(v) })}>
                                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="inherit">继承</SelectItem>
                                                                    <SelectItem value="5">5分钟</SelectItem>
                                                                    <SelectItem value="10">10分钟</SelectItem>
                                                                    <SelectItem value="30">30分钟</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">活跃时段开始</Label>
                                                            <Input type="number" min={0} max={23} value={form.proactiveChatTimeStart} onChange={e => setForm({ ...form, proactiveChatTimeStart: parseInt(e.target.value) || 8 })} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">活跃时段结束</Label>
                                                            <Input type="number" min={0} max={23} value={form.proactiveChatTimeEnd} onChange={e => setForm({ ...form, proactiveChatTimeEnd: parseInt(e.target.value) || 23 })} />
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
                                                    <Select value={form.bymReplyLength} onValueChange={v => setForm({ ...form, bymReplyLength: v })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="short">简短</SelectItem>
                                                            <SelectItem value="medium">适中</SelectItem>
                                                            <SelectItem value="long">详细</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="flex items-center gap-2 pt-5">
                                                    <Switch checked={form.bymUseEmoji} onCheckedChange={v => setForm({ ...form, bymUseEmoji: v })} />
                                                    <Label className="text-sm">使用表情</Label>
                                                </div>
                                            </div>
                                        </div>
                                    </FeatureItem>
                                </div>
                            )}

                            {/* 对话设置 Tab */}
                            {activeTab === 'channel' && (
                                <div className="space-y-4">
                                    {/* 聊天配置 */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4 text-blue-500" />
                                            <Label className="text-base font-medium">聊天配置</Label>
                                        </div>
                                        <div className="space-y-3 p-3 rounded-lg border bg-card">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">上下文长度</Label>
                                                    <Input type="number" min={1} max={100} value={form.chatContextLength} onChange={e => setForm({ ...form, chatContextLength: parseInt(e.target.value) || 20 })} />
                                                </div>
                                                <div className="flex items-center gap-2 pt-5">
                                                    <Switch checked={form.chatEnabled} onCheckedChange={v => setForm({ ...form, chatEnabled: v })} />
                                                    <Label className="text-sm">启用对话</Label>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="flex items-center gap-2">
                                                    <Switch checked={form.chatStreamReply} onCheckedChange={v => setForm({ ...form, chatStreamReply: v })} />
                                                    <Label className="text-xs">流式回复</Label>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Switch checked={form.chatQuoteReply} onCheckedChange={v => setForm({ ...form, chatQuoteReply: v })} />
                                                    <Label className="text-xs">引用回复</Label>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Switch checked={form.chatShowThinking} onCheckedChange={v => setForm({ ...form, chatShowThinking: v })} />
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
                                            <Button variant="outline" size="sm" onClick={() => {
                                                setEditingChannelIndex(null)
                                                setChannelForm({ name: '', baseUrl: '', apiKey: '', adapterType: 'openai', models: '', enabled: true, priority: 0, modelsPath: '', chatPath: '', imageTransferMode: 'auto', imageCompress: true, imageQuality: 85, imageMaxSize: 4096 })
                                                setChannelDialogOpen(true)
                                            }}>
                                                <Plus className="h-4 w-4 mr-2" />添加渠道
                                            </Button>
                                        </div>
                                        <p className="text-xs text-muted-foreground">配置本群专用的API渠道</p>

                                        {form.independentChannels.length === 0 ? (
                                            <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                                                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                                <p>暂无独立渠道</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {form.independentChannels.map((channel, index) => (
                                                    <div key={channel.id} className="p-4 rounded-lg border bg-card">
                                                        <div className="flex items-start justify-between">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <h4 className="font-medium">{channel.name}</h4>
                                                                    <Badge variant={channel.enabled ? 'default' : 'secondary'}>{channel.enabled ? '启用' : '禁用'}</Badge>
                                                                    <Badge variant="outline">{channel.adapterType}</Badge>
                                                                </div>
                                                                <p className="text-xs text-muted-foreground mt-1 truncate">{channel.baseUrl || '使用默认地址'}</p>
                                                                <div className="flex gap-1 mt-2 flex-wrap">
                                                                    {channel.models.slice(0, 3).map(model => (
                                                                        <Badge key={model} variant="secondary" className="text-xs">{model}</Badge>
                                                                    ))}
                                                                    {channel.models.length > 3 && <Badge variant="secondary" className="text-xs">+{channel.models.length - 3}</Badge>}
                                                                </div>
                                                            </div>
                                                            <div className="flex gap-1 shrink-0">
                                                <Button variant="ghost" size="icon" onClick={() => {
                                                                    setEditingChannelIndex(index)
                                                                    // 编辑时，保留原有的 API Key （已被掩码）
                                                                    setChannelForm({
                                                                        name: channel.name, baseUrl: channel.baseUrl, 
                                                                        apiKey: channel.apiKey, // 保留被掩码的 key
                                                                        adapterType: channel.adapterType, models: channel.models.join(','),
                                                                        enabled: channel.enabled, priority: channel.priority,
                                                                        modelsPath: channel.modelsPath || '', chatPath: channel.chatPath || '',
                                                                        imageTransferMode: channel.imageConfig?.transferMode || 'auto',
                                                                        imageCompress: channel.imageConfig?.compress ?? true,
                                                                        imageQuality: channel.imageConfig?.quality ?? 85,
                                                                        imageMaxSize: channel.imageConfig?.maxSize ?? 4096
                                                                    })
                                                                    setChannelDialogOpen(true)
                                                                }}>
                                                                    <Settings className="h-4 w-4" />
                                                                </Button>
                                                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => {
                                                                    if (confirm('确定要删除这个渠道吗？')) {
                                                                        const newChannels = [...form.independentChannels]
                                                                        newChannels.splice(index, 1)
                                                                        setForm({ ...form, independentChannels: newChannels })
                                                                    }
                                                                }}>
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 高级配置 Tab */}
                            {activeTab === 'advanced' && (
                                <div className="space-y-4">
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Bot className="h-4 w-4 text-muted-foreground" />
                                            <Label>模型配置</Label>
                                        </div>
                                        <p className="text-xs text-muted-foreground">为本群配置独立模型（留空使用全局）</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <ModelSelect label="对话模型" value={form.chatModel} models={allModels} onChange={v => setForm({ ...form, chatModel: v })} />
                                            <ModelSelect label="总结模型" value={form.summaryModel} models={allModels} onChange={v => setForm({ ...form, summaryModel: v })} />
                                            <ModelSelect label="伪人模型" value={form.bymModel} models={allModels} onChange={v => setForm({ ...form, bymModel: v })} />
                                            <ModelSelect label="绘图模型" value={form.imageGenModel} models={allModels} onChange={v => setForm({ ...form, imageGenModel: v })} />
                                        </div>
                                    </div>

                                    {knowledgeBases.length > 0 && (
                                        <div className="space-y-3 border-t pt-4 mt-4">
                                            <div className="flex items-center gap-2">
                                                <Brain className="h-4 w-4 text-muted-foreground" />
                                                <Label>知识库</Label>
                                            </div>
                                            <p className="text-xs text-muted-foreground">为本群关联知识库</p>
                                            <div className="space-y-2">
                                                {knowledgeBases.map(kb => (
                                                    <div key={kb.id} className="flex items-center gap-2 p-2 rounded border bg-card">
                                                        <Switch
                                                            checked={form.knowledgeIds.includes(kb.id)}
                                                            onCheckedChange={checked => {
                                                                if (checked) setForm({ ...form, knowledgeIds: [...form.knowledgeIds, kb.id] })
                                                                else setForm({ ...form, knowledgeIds: form.knowledgeIds.filter(id => id !== kb.id) })
                                                            }}
                                                        />
                                                        <span className="text-sm">{kb.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="border-t pt-4 mt-4">
                                        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                            <div className="flex items-start gap-3">
                                                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                                                <div className="space-y-1">
                                                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">权限说明</p>
                                                    <p className="text-xs text-amber-800 dark:text-amber-200">
                                                        群管理面板仅支持配置本群独立渠道，不能修改以下设置：
                                                    </p>
                                                    <ul className="text-xs text-amber-800 dark:text-amber-200 list-disc list-inside space-y-0.5 ml-1">
                                                        <li>禁用全局模型（仅主管理面板可配置）</li>
                                                        <li>其他高级系统配置</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="mt-6 text-center text-xs text-muted-foreground">
                        ChatGPT Plugin 群管理面板 · 群 {groupId}
                    </div>
                </div>
            </main>

            {/* 移动端底部导航 */}
            {isMobile && (
                <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t">
                    <div className="grid grid-cols-5 h-14">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'flex flex-col items-center justify-center gap-0.5 transition-colors',
                                    activeTab === tab.id ? 'text-primary' : 'text-muted-foreground'
                                )}
                            >
                                {tab.icon}
                                <span className="text-[10px] font-medium">{tab.mobileLabel}</span>
                            </button>
                        ))}
                    </div>
                </nav>
            )}

            {/* 表情大图预览 */}
            <Dialog open={!!viewEmoji} onOpenChange={v => !v && setViewEmoji(null)}>
                <DialogContent className="max-w-sm p-0 overflow-hidden bg-transparent border-none">
                    {viewEmoji && (
                        <div className="relative">
                            <img src={viewEmoji.url} alt={viewEmoji.name} className="w-full h-auto rounded-lg shadow-2xl" />
                            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
                                <Button variant="secondary" size="sm" onClick={() => deleteEmoji(viewEmoji.name)}>
                                    <Trash2 className="h-4 w-4 mr-1" /> 删除
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setViewEmoji(null)}>关闭</Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 渠道编辑弹窗 - 使用统一的 ChannelDialog 组件 */}
            <ChannelDialog
                open={channelDialogOpen}
                onOpenChange={setChannelDialogOpen}
                channelForm={channelForm}
                onChannelFormChange={setChannelForm}
                isEditing={editingChannelIndex !== null}
                authToken={getToken()}
                onSave={() => {
                    if (!channelForm.name || !channelForm.baseUrl || !channelForm.apiKey) {
                        toast.error('请填写必要信息')
                        return
                    }
                    const newChannel: IndependentChannel = {
                        id: editingChannelIndex !== null ? form.independentChannels[editingChannelIndex].id : Math.random().toString(36).substring(7),
                        name: channelForm.name,
                        baseUrl: channelForm.baseUrl,
                        apiKey: channelForm.apiKey, // 保存完整的 API Key
                        adapterType: channelForm.adapterType,
                        models: channelForm.models.split(',').map(m => m.trim()).filter(Boolean),
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
                    if (editingChannelIndex !== null) newChannels[editingChannelIndex] = newChannel
                    else newChannels.push(newChannel)
                    setForm({ ...form, independentChannels: newChannels })
                    setChannelDialogOpen(false)
                    toast.success(editingChannelIndex !== null ? '渠道已更新' : '渠道已添加')
                }}
                onFetchModels={async () => {
                    if (!channelForm.baseUrl || !channelForm.apiKey) {
                        toast.error('请先填写 Base URL 和 API Key')
                        return []
                    }
                    try {
                        const res = await fetch('/chatai/api/admin/models/fetch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                            body: JSON.stringify({ baseUrl: channelForm.baseUrl, apiKey: channelForm.apiKey, adapterType: channelForm.adapterType })
                        })
                        const data = await res.json()
                        if (data.code === 0) {
                            toast.success(`获取到 ${data.data.length} 个模型`)
                            return data.data
                        } else {
                            toast.error(data.message || '获取失败')
                            return []
                        }
                    } catch {
                        toast.error('获取失败')
                        return []
                    }
                }}
            />
        </div>
    )
}
