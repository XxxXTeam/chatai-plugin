'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
    ArrowLeft,
    Loader2,
    Save,
    Settings,
    Zap,
    Sparkles,
    BookOpen,
    Power,
    X,
    Image,
    MessageSquare,
    Bot,
    Users,
    Clock,
    UserPlus,
    UserMinus,
    Smile,
    Server,
    Gauge,
    Plus,
    Trash2,
    RefreshCw,
    Eye,
    EyeOff,
    Palette,
    MousePointer2,
    Gamepad2
} from 'lucide-react'
import { scopeApi, presetsApi, channelsApi, knowledgeApi } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { FeatureSwitch } from '@/components/group-form/feature-switch'
import { EventConfig } from '@/components/group-form/event-config'
import { ProbabilitySlider } from '@/components/group-form/probability-slider'
import { FormNumberInput } from '@/components/group-form/form-number-input'
import { ModelSelect } from '@/components/group-form/model-select'
import { IndependentChannel, Channel, Preset } from '@/lib/types'
import { ChannelDialog, ChannelFormData } from '@/components/group-editor/ChannelDialog'

interface GroupEditorProps {
    id: string
}

export function GroupEditor({ id }: GroupEditorProps) {
    const router = useRouter()
    const isMobile = useIsMobile()
    const isNew = id === 'new'
    const [loading, setLoading] = useState(!isNew)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState('basic')
    const [presets, setPresets] = useState<Preset[]>([])
    const [knowledgeDocs, setKnowledgeDocs] = useState<{ id: string; name: string }[]>([])
    const [allModels, setAllModels] = useState<string[]>([])
    
    // 渠道编辑相关状态
    const [channelDialogOpen, setChannelDialogOpen] = useState(false)
    const [editingChannelIndex, setEditingChannelIndex] = useState<number | null>(null)
    const [channelForm, setChannelForm] = useState<ChannelFormData>({
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

    const [form, setForm] = useState({
        groupId: '',
        groupName: '',
        enabled: true,
        presetId: '',
        systemPrompt: '',
        triggerMode: 'default',
        customPrefix: '',
        // 模型配置
        chatModel: '',
        summaryModel: '',
        bymModel: '',
        gameModel: '',
        imageGenModel: '',
        // 游戏模式配置
        gameProbability: 'inherit' as 'inherit' | number,
        gameEnableTools: 'inherit' as 'inherit' | 'on' | 'off',
        gameTemperature: 'inherit' as 'inherit' | number,
        gameMaxTokens: 'inherit' as 'inherit' | number,
        // 功能开关
        toolsEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        imageGenEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        summaryEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        eventEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        // 伪人配置
        bymEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        bymPresetId: '',
        bymPrompt: '',
        bymProbability: 'inherit' as 'inherit' | number,
        bymTemperature: 'inherit' as 'inherit' | number,
        bymMaxTokens: 'inherit' as 'inherit' | number,
        bymReplyLength: 'medium' as string,
        bymUseEmoji: true,
        // 主动发言（合并到伪人）
        proactiveChatEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        proactiveChatProbability: 'inherit' as 'inherit' | number,
        proactiveChatCooldown: 'inherit' as 'inherit' | number,
        proactiveChatMaxDaily: 'inherit' as 'inherit' | number,
        proactiveChatMinMessages: 5,
        proactiveChatTimeStart: 8,
        proactiveChatTimeEnd: 23,
        // 事件配置
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
        // 表情包小偷/随机发图
        emojiThiefEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        emojiThiefSeparateFolder: true,
        emojiThiefMaxCount: 500,
        emojiThiefStealRate: 1.0,
        emojiThiefTriggerRate: 0.05,
        emojiThiefTriggerMode: 'off' as string,
        // 聊天配置
        chatContextLength: 20,
        chatStreamReply: true,
        chatQuoteReply: false,
        chatShowThinking: true,
        // 黑白名单
        listMode: 'none' as string,
        blacklist: [] as string[],
        whitelist: [] as string[],
        // 定时总结推送
        summaryPushEnabled: false,
        summaryPushIntervalType: 'day' as 'day' | 'hour',
        summaryPushIntervalValue: 1,
        summaryPushHour: 20,
        summaryPushMessageCount: 100,
        // 群独立渠道（支持多个）
        independentChannels: [] as IndependentChannel[],
        forbidGlobalModel: false,
        // 使用限制
        dailyGroupLimit: 0,
        dailyUserLimit: 0,
        usageLimitMessage: '',
        // 知识库
        knowledgeIds: [] as string[]
    })

    useEffect(() => {
        loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    const loadData = async () => {
        try {
            const [presetsRes, channelsRes, knowledgeRes] = await Promise.all([
                presetsApi.list(),
                channelsApi.list(),
                knowledgeApi.list()
            ])
            setPresets(presetsRes?.data || [])
            setKnowledgeDocs(
                (knowledgeRes?.data || []).map((k: { id: string; name: string }) => ({ id: k.id, name: k.name }))
            )

            // 收集所有模型
            const models = new Set<string>()
            ;((channelsRes as { data?: Channel[] })?.data || []).forEach((ch: Channel) => {
                if (Array.isArray(ch.models)) {
                    ch.models.forEach((m: string) => models.add(m))
                }
            })
            setAllModels(Array.from(models).sort())

            if (!isNew) {
                const groupsRes = await scopeApi.getGroups()
                const group = (groupsRes?.data || []).find((g: { groupId: string }) => g.groupId === id)
                if (group) {
                    const settings = group.settings || {}
                    setForm({
                        groupId: group.groupId,
                        groupName: group.groupName || '',
                        enabled: group.enabled !== false,
                        presetId: group.presetId || '',
                        systemPrompt: group.systemPrompt || '',
                        triggerMode: settings.triggerMode || 'default',
                        customPrefix: settings.customPrefix || '',
                        chatModel: settings.chatModel || '',
                        summaryModel: settings.summaryModel || '',
                        bymModel: settings.bymModel || '',
                        gameModel: settings.gameModel || '',
                        imageGenModel: settings.imageGenModel || '',
                        gameProbability: settings.gameProbability === undefined || settings.gameProbability === 'inherit' ? 'inherit' : Number(settings.gameProbability),
                        gameEnableTools: settings.gameEnableTools === undefined ? 'inherit' : settings.gameEnableTools ? 'on' : 'off',
                        gameTemperature: settings.gameTemperature === undefined || settings.gameTemperature === 'inherit' ? 'inherit' : Number(settings.gameTemperature),
                        gameMaxTokens: settings.gameMaxTokens === undefined || settings.gameMaxTokens === 'inherit' ? 'inherit' : Number(settings.gameMaxTokens),
                        toolsEnabled: settings.toolsEnabled === undefined ? 'inherit' : settings.toolsEnabled ? 'on' : 'off',
                        imageGenEnabled: settings.imageGenEnabled === undefined ? 'inherit' : settings.imageGenEnabled ? 'on' : 'off',
                        summaryEnabled: settings.summaryEnabled === undefined ? 'inherit' : settings.summaryEnabled ? 'on' : 'off',
                        eventEnabled: settings.eventEnabled === undefined ? 'inherit' : settings.eventEnabled ? 'on' : 'off',
                        bymEnabled: settings.bymEnabled === undefined ? 'inherit' : settings.bymEnabled ? 'on' : 'off',
                        bymPresetId: settings.bymPresetId || '',
                        bymPrompt: settings.bymPrompt || '',
                        bymProbability: settings.bymProbability === undefined || settings.bymProbability === 'inherit' ? 'inherit' : Number(settings.bymProbability),
                        bymTemperature: settings.bymTemperature === undefined || settings.bymTemperature === 'inherit' ? 'inherit' : Number(settings.bymTemperature),
                        bymMaxTokens: settings.bymMaxTokens === undefined || settings.bymMaxTokens === 'inherit' ? 'inherit' : Number(settings.bymMaxTokens),
                        proactiveChatEnabled: settings.proactiveChatEnabled === undefined ? 'inherit' : settings.proactiveChatEnabled ? 'on' : 'off',
                        proactiveChatProbability: settings.proactiveChatProbability ?? 'inherit',
                        proactiveChatCooldown: settings.proactiveChatCooldown ?? 'inherit',
                        proactiveChatMaxDaily: settings.proactiveChatMaxDaily ?? 'inherit',
                        welcomeEnabled: settings.welcomeEnabled === undefined ? 'inherit' : settings.welcomeEnabled ? 'on' : 'off',
                        welcomeMessage: settings.welcomeMessage || '',
                        welcomePrompt: settings.welcomePrompt || '',
                        welcomeProbability: settings.welcomeProbability ?? 'inherit',
                        goodbyeEnabled: settings.goodbyeEnabled === undefined ? 'inherit' : settings.goodbyeEnabled ? 'on' : 'off',
                        goodbyePrompt: settings.goodbyePrompt || '',
                        goodbyeProbability: settings.goodbyeProbability ?? 'inherit',
                        pokeEnabled: settings.pokeEnabled === undefined ? 'inherit' : settings.pokeEnabled ? 'on' : 'off',
                        pokeBack: settings.pokeBack || false,
                        pokeProbability: settings.pokeProbability ?? 'inherit',
                        // 其他事件
                        recallEnabled: settings.recallEnabled === undefined ? 'inherit' : settings.recallEnabled ? 'on' : 'off',
                        recallProbability: settings.recallProbability ?? 'inherit',
                        banEnabled: settings.banEnabled === undefined ? 'inherit' : settings.banEnabled ? 'on' : 'off',
                        banProbability: settings.banProbability ?? 'inherit',
                        luckyKingEnabled: settings.luckyKingEnabled === undefined ? 'inherit' : settings.luckyKingEnabled ? 'on' : 'off',
                        luckyKingProbability: settings.luckyKingProbability ?? 'inherit',
                        honorEnabled: settings.honorEnabled === undefined ? 'inherit' : settings.honorEnabled ? 'on' : 'off',
                        honorProbability: settings.honorProbability ?? 'inherit',
                        essenceEnabled: settings.essenceEnabled === undefined ? 'inherit' : settings.essenceEnabled ? 'on' : 'off',
                        essenceProbability: settings.essenceProbability ?? 'inherit',
                        adminEnabled: settings.adminEnabled === undefined ? 'inherit' : settings.adminEnabled ? 'on' : 'off',
                        adminProbability: settings.adminProbability ?? 'inherit',
                        emojiThiefEnabled: settings.emojiThiefEnabled === undefined ? 'inherit' : settings.emojiThiefEnabled ? 'on' : 'off',
                        emojiThiefSeparateFolder: settings.emojiThiefSeparateFolder ?? true,
                        emojiThiefMaxCount: settings.emojiThiefMaxCount ?? 500,
                        emojiThiefStealRate: settings.emojiThiefStealRate ?? 1.0,
                        emojiThiefTriggerRate: settings.emojiThiefTriggerRate ?? 0.05,
                        emojiThiefTriggerMode: settings.emojiThiefTriggerMode || 'off',
                        bymReplyLength: settings.bymReplyLength || 'medium',
                        bymUseEmoji: settings.bymUseEmoji ?? true,
                        proactiveChatMinMessages: settings.proactiveChatMinMessages ?? 5,
                        proactiveChatTimeStart: settings.proactiveChatTimeStart ?? 8,
                        proactiveChatTimeEnd: settings.proactiveChatTimeEnd ?? 23,
                        chatContextLength: settings.chatContextLength ?? 20,
                        chatStreamReply: settings.chatStreamReply ?? true,
                        chatQuoteReply: settings.chatQuoteReply ?? false,
                        chatShowThinking: settings.chatShowThinking ?? true,
                        listMode: settings.listMode || 'none',
                        blacklist: settings.blacklist || [],
                        whitelist: settings.whitelist || [],
                        summaryPushEnabled: settings.summaryPushEnabled ?? false,
                        summaryPushIntervalType: settings.summaryPushIntervalType || 'day',
                        summaryPushIntervalValue: settings.summaryPushIntervalValue ?? 1,
                        summaryPushHour: settings.summaryPushHour ?? 20,
                        summaryPushMessageCount: settings.summaryPushMessageCount ?? 100,
                        independentChannels: settings.independentChannels || [],
                        forbidGlobalModel: settings.forbidGlobalModel || false,
                        dailyGroupLimit: settings.usageLimit?.dailyGroupLimit || 0,
                        dailyUserLimit: settings.usageLimit?.dailyUserLimit || 0,
                        usageLimitMessage: settings.usageLimit?.limitMessage || '',
                        knowledgeIds: group.knowledgeIds || []
                    })
                }
            }
        } catch (error) {
            console.error('加载数据失败', error)
            toast.error('加载数据失败')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        if (!form.groupId) {
            toast.error('请填写群号')
            return
        }

        setSaving(true)
        try {
            await scopeApi.updateGroup(form.groupId, {
                groupName: form.groupName,
                presetId: form.presetId || undefined,
                systemPrompt: form.systemPrompt || undefined,
                enabled: form.enabled,
                knowledgeIds: form.knowledgeIds.length > 0 ? form.knowledgeIds : undefined,
                triggerMode: form.triggerMode,
                customPrefix: form.customPrefix || undefined,
                chatModel: form.chatModel || undefined,
                summaryModel: form.summaryModel || undefined,
                bymModel: form.bymModel || undefined,
                gameModel: form.gameModel || undefined,
                imageGenModel: form.imageGenModel || undefined,
                gameProbability: form.gameProbability === 'inherit' ? undefined : form.gameProbability,
                gameEnableTools: form.gameEnableTools === 'inherit' ? undefined : form.gameEnableTools === 'on',
                gameTemperature: form.gameTemperature === 'inherit' ? undefined : form.gameTemperature,
                gameMaxTokens: form.gameMaxTokens === 'inherit' ? undefined : form.gameMaxTokens,
                toolsEnabled: form.toolsEnabled === 'inherit' ? undefined : form.toolsEnabled === 'on',
                imageGenEnabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
                summaryEnabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
                eventEnabled: form.eventEnabled === 'inherit' ? undefined : form.eventEnabled === 'on',
                bymEnabled: form.bymEnabled === 'inherit' ? undefined : form.bymEnabled === 'on',
                bymPresetId: form.bymPresetId || undefined,
                bymPrompt: form.bymPrompt || undefined,
                bymProbability: form.bymProbability === 'inherit' ? undefined : form.bymProbability,
                bymTemperature: form.bymTemperature === 'inherit' ? undefined : form.bymTemperature,
                bymMaxTokens: form.bymMaxTokens === 'inherit' ? undefined : form.bymMaxTokens,
                proactiveChatEnabled: form.proactiveChatEnabled === 'inherit' ? undefined : form.proactiveChatEnabled === 'on',
                proactiveChatProbability: form.proactiveChatProbability === 'inherit' ? undefined : form.proactiveChatProbability,
                proactiveChatCooldown: form.proactiveChatCooldown === 'inherit' ? undefined : form.proactiveChatCooldown,
                proactiveChatMaxDaily: form.proactiveChatMaxDaily === 'inherit' ? undefined : form.proactiveChatMaxDaily,
                welcomeEnabled: form.welcomeEnabled === 'inherit' ? undefined : form.welcomeEnabled === 'on',
                welcomeMessage: form.welcomeMessage || undefined,
                welcomePrompt: form.welcomePrompt || undefined,
                welcomeProbability: form.welcomeProbability === 'inherit' ? undefined : form.welcomeProbability,
                goodbyeEnabled: form.goodbyeEnabled === 'inherit' ? undefined : form.goodbyeEnabled === 'on',
                goodbyePrompt: form.goodbyePrompt || undefined,
                goodbyeProbability: form.goodbyeProbability === 'inherit' ? undefined : form.goodbyeProbability,
                pokeEnabled: form.pokeEnabled === 'inherit' ? undefined : form.pokeEnabled === 'on',
                pokeBack: form.pokeBack,
                pokeProbability: form.pokeProbability === 'inherit' ? undefined : form.pokeProbability,
                // 其他事件
                recallEnabled: form.recallEnabled === 'inherit' ? undefined : form.recallEnabled === 'on',
                recallProbability: form.recallProbability === 'inherit' ? undefined : form.recallProbability,
                banEnabled: form.banEnabled === 'inherit' ? undefined : form.banEnabled === 'on',
                banProbability: form.banProbability === 'inherit' ? undefined : form.banProbability,
                luckyKingEnabled: form.luckyKingEnabled === 'inherit' ? undefined : form.luckyKingEnabled === 'on',
                luckyKingProbability: form.luckyKingProbability === 'inherit' ? undefined : form.luckyKingProbability,
                honorEnabled: form.honorEnabled === 'inherit' ? undefined : form.honorEnabled === 'on',
                honorProbability: form.honorProbability === 'inherit' ? undefined : form.honorProbability,
                essenceEnabled: form.essenceEnabled === 'inherit' ? undefined : form.essenceEnabled === 'on',
                essenceProbability: form.essenceProbability === 'inherit' ? undefined : form.essenceProbability,
                adminEnabled: form.adminEnabled === 'inherit' ? undefined : form.adminEnabled === 'on',
                adminProbability: form.adminProbability === 'inherit' ? undefined : form.adminProbability,
                emojiThiefEnabled: form.emojiThiefEnabled === 'inherit' ? undefined : form.emojiThiefEnabled === 'on',
                emojiThiefSeparateFolder: form.emojiThiefSeparateFolder,
                emojiThiefMaxCount: form.emojiThiefMaxCount,
                emojiThiefStealRate: form.emojiThiefStealRate,
                emojiThiefTriggerRate: form.emojiThiefTriggerRate,
                emojiThiefTriggerMode: form.emojiThiefTriggerMode,
                bymReplyLength: form.bymReplyLength,
                bymUseEmoji: form.bymUseEmoji,
                proactiveChatMinMessages: form.proactiveChatMinMessages,
                proactiveChatTimeStart: form.proactiveChatTimeStart,
                proactiveChatTimeEnd: form.proactiveChatTimeEnd,
                chatContextLength: form.chatContextLength,
                chatStreamReply: form.chatStreamReply,
                chatQuoteReply: form.chatQuoteReply,
                chatShowThinking: form.chatShowThinking,
                listMode: form.listMode !== 'none' ? form.listMode : undefined,
                blacklist: form.blacklist.length > 0 ? form.blacklist : undefined,
                whitelist: form.whitelist.length > 0 ? form.whitelist : undefined,
                summaryPushEnabled: form.summaryPushEnabled,
                summaryPushIntervalType: form.summaryPushIntervalType,
                summaryPushIntervalValue: form.summaryPushIntervalValue,
                summaryPushHour: form.summaryPushHour,
                summaryPushMessageCount: form.summaryPushMessageCount,
                independentChannels: form.independentChannels.length > 0 ? form.independentChannels : undefined,
                forbidGlobalModel: form.forbidGlobalModel,
                usageLimit: {
                    dailyGroupLimit: form.dailyGroupLimit,
                    dailyUserLimit: form.dailyUserLimit,
                    limitMessage: form.usageLimitMessage || undefined
                }
            })
            toast.success('保存成功')
            if (isNew) {
                router.push('/groups')
            }
        } catch (error) {
            console.error('保存失败', error)
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const editorTabs = [
        { id: 'basic', label: '基础', icon: <Settings className="h-4 w-4" /> },
        { id: 'features', label: '功能', icon: <Zap className="h-4 w-4" /> },
        { id: 'bym', label: '伪人', icon: <Smile className="h-4 w-4" /> },
        { id: 'game', label: '游戏', icon: <Gamepad2 className="h-4 w-4" /> },
        { id: 'channel', label: '渠道', icon: <Server className="h-4 w-4" /> },
        { id: 'advanced', label: '高级', icon: <Sparkles className="h-4 w-4" /> },
    ]

    return (
        <div className="max-w-7xl mx-auto px-4 py-4 space-y-4 flex-1 h-full flex flex-col">
            {/* 头部 */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.push('/groups')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-2xl font-bold truncate">{isNew ? '添加群组' : '编辑群组'}</h1>
                        <p className="text-xs sm:text-sm text-muted-foreground truncate">
                            {isNew ? '配置新群组的个性化设置' : `群号: ${form.groupId}`}
                        </p>
                    </div>
                </div>
                <Button onClick={handleSave} disabled={saving} size="sm" className="shrink-0">
                    {saving ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" /> : <Save className="h-4 w-4 sm:mr-2" />}
                    <span className="hidden sm:inline">保存</span>
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className={cn(!isMobile && 'flex gap-6', 'flex-1 min-h-0')}>
                {/* 桌面端：侧边Tab导航 */}
                {!isMobile ? (
                    <nav className="w-48 shrink-0">
                        <div className="sticky top-4 space-y-1">
                            {editorTabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                                        activeTab === tab.id
                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                    )}
                                >
                                    {tab.icon}
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </nav>
                ) : (
                    /* 移动端：水平 Tab 条 */
                    <TabsList className="grid w-full grid-cols-6 h-auto mb-3">
                        {editorTabs.map(tab => (
                            <TabsTrigger key={tab.id} value={tab.id} className="text-xs px-1 py-2">
                                {tab.icon}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                )}

                <div className={cn(!isMobile && 'flex-1 min-w-0')}>

                {/* 基础设置 */}
                <TabsContent value="basic" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                基本信息
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>群号 *</Label>
                                    <Input
                                        value={form.groupId}
                                        onChange={e => setForm({ ...form, groupId: e.target.value })}
                                        placeholder="输入群号"
                                        disabled={!isNew}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>群名称</Label>
                                    <Input
                                        value={form.groupName}
                                        onChange={e => setForm({ ...form, groupName: e.target.value })}
                                        placeholder="群名称（可选）"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-3 rounded-lg border">
                                <div className="flex items-center gap-3">
                                    <Power className="h-4 w-4 text-green-500" />
                                    <div>
                                        <p className="text-sm font-medium">启用本群</p>
                                        <p className="text-xs text-muted-foreground">关闭后机器人将不响应本群消息</p>
                                    </div>
                                </div>
                                <Switch
                                    checked={form.enabled}
                                    onCheckedChange={v => setForm({ ...form, enabled: v })}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <MessageSquare className="h-4 w-4" />
                                触发设置
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
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
                                        <SelectItem value="default">默认（@或前缀）</SelectItem>
                                        <SelectItem value="at">仅@触发</SelectItem>
                                        <SelectItem value="prefix">仅前缀触发</SelectItem>
                                        <SelectItem value="all">所有消息触发</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>自定义前缀</Label>
                                <Input
                                    value={form.customPrefix}
                                    onChange={e => setForm({ ...form, customPrefix: e.target.value })}
                                    placeholder="留空使用全局前缀"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <BookOpen className="h-4 w-4" />
                                人设与预设
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>选择预设</Label>
                                    <Select
                                        value={form.presetId || '__none__'}
                                        onValueChange={v => setForm({ ...form, presetId: v === '__none__' ? '' : v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="不使用预设" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">不使用预设</SelectItem>
                                            {presets.map(p => (
                                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <ModelSelect
                                        label="对话模型"
                                        value={form.chatModel}
                                        models={allModels}
                                        onChange={v => setForm({ ...form, chatModel: v })}
                                        placeholder="使用全局"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>系统提示词</Label>
                                <Textarea
                                    value={form.systemPrompt}
                                    onChange={e => setForm({ ...form, systemPrompt: e.target.value })}
                                    placeholder="留空使用预设或全局提示词"
                                    rows={3}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* 聊天配置 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <MessageSquare className="h-4 w-4" />
                                聊天配置
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-4 gap-3">
                                <FormNumberInput
                                    label="上下文长度"
                                    min={1}
                                    max={100}
                                    value={form.chatContextLength}
                                    onChange={e => setForm({ ...form, chatContextLength: parseInt(e.target.value) || 20 })}
                                />
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">流式回复</Label>
                                    <Switch
                                        checked={form.chatStreamReply}
                                        onCheckedChange={v => setForm({ ...form, chatStreamReply: v })}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">引用回复</Label>
                                    <Switch
                                        checked={form.chatQuoteReply}
                                        onCheckedChange={v => setForm({ ...form, chatQuoteReply: v })}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">显示思考</Label>
                                    <Switch
                                        checked={form.chatShowThinking}
                                        onCheckedChange={v => setForm({ ...form, chatShowThinking: v })}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* 功能设置 */}
                <TabsContent value="features" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">功能开关</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {/* 工具调用 */}
                            <FeatureSwitch
                                icon={<Zap className="h-4 w-4 text-yellow-500" />}
                                title="工具调用"
                                desc="允许AI调用外部工具"
                                value={form.toolsEnabled}
                                onChange={v => setForm({ ...form, toolsEnabled: v })}
                            />

                            {/* 绘图功能 */}
                            <FeatureSwitch
                                icon={<Image className="h-4 w-4 text-pink-500" />}
                                title="绘图功能"
                                desc="文生图、图生图等"
                                value={form.imageGenEnabled}
                                onChange={v => setForm({ ...form, imageGenEnabled: v })}
                            />
                            {form.imageGenEnabled === 'on' && (
                                <div className="ml-12 p-3 rounded-lg bg-muted/50 space-y-2">
                                    <ModelSelect
                                        label="绘图模型"
                                        value={form.imageGenModel}
                                        models={allModels.filter(m => m.includes('dall') || m.includes('flux') || m.includes('image'))}
                                        onChange={v => setForm({ ...form, imageGenModel: v })}
                                        placeholder="继承全局"
                                    />
                                </div>
                            )}

                            {/* 群聊总结 */}
                            <FeatureSwitch
                                icon={<BookOpen className="h-4 w-4 text-blue-500" />}
                                title="群聊总结"
                                desc="自动总结群聊内容"
                                value={form.summaryEnabled}
                                onChange={v => setForm({ ...form, summaryEnabled: v })}
                            />
                            {form.summaryEnabled === 'on' && (
                                <div className="ml-12 p-3 rounded-lg bg-muted/50 space-y-3">
                                    <div className="space-y-2">
                                        <ModelSelect
                                            label="总结模型"
                                            value={form.summaryModel}
                                            models={allModels}
                                            onChange={v => setForm({ ...form, summaryModel: v })}
                                            placeholder="继承全局"
                                        />
                                    </div>
                                    {/* 定时推送 */}
                                    <div className="flex items-center justify-between pt-2 border-t">
                                        <div>
                                            <p className="text-sm font-medium">定时推送</p>
                                            <p className="text-xs text-muted-foreground">自动定时推送群聊总结</p>
                                        </div>
                                        <Switch
                                            checked={form.summaryPushEnabled}
                                            onCheckedChange={v => setForm({ ...form, summaryPushEnabled: v })}
                                        />
                                    </div>
                                    {form.summaryPushEnabled && (
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            <div className="space-y-1">
                                                <Label className="text-xs">间隔类型</Label>
                                                <Select
                                                    value={form.summaryPushIntervalType}
                                                    onValueChange={(v: 'hour' | 'day') => setForm({ ...form, summaryPushIntervalType: v })}
                                                >
                                                    <SelectTrigger className="h-9">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="hour">每X小时</SelectItem>
                                                        <SelectItem value="day">每X天</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <FormNumberInput
                                                label="间隔值"
                                                min={1}
                                                value={form.summaryPushIntervalValue}
                                                onChange={e => setForm({ ...form, summaryPushIntervalValue: parseInt(e.target.value) || 1 })}
                                            />
                                            {form.summaryPushIntervalType === 'day' && (
                                                <FormNumberInput
                                                    label="推送时间(点)"
                                                    min={0}
                                                    max={23}
                                                    value={form.summaryPushHour}
                                                    onChange={e => setForm({ ...form, summaryPushHour: parseInt(e.target.value) || 20 })}
                                                />
                                            )}
                                            <FormNumberInput
                                                label="消息数量"
                                                min={10}
                                                value={form.summaryPushMessageCount}
                                                onChange={e => setForm({ ...form, summaryPushMessageCount: parseInt(e.target.value) || 100 })}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 事件响应 */}
                            <FeatureSwitch
                                icon={<Sparkles className="h-4 w-4 text-purple-500" />}
                                title="事件响应"
                                desc="入群、退群、戳一戳等（开启后在下方配置详情）"
                                value={form.eventEnabled}
                                onChange={v => setForm({ ...form, eventEnabled: v })}
                            />

                            {/* 表情包小偷/随机发图 */}
                            <FeatureSwitch
                                icon={<Palette className="h-4 w-4 text-cyan-500" />}
                                title="表情包小偷"
                                desc="自动收集和发送表情包"
                                value={form.emojiThiefEnabled}
                                onChange={v => setForm({ ...form, emojiThiefEnabled: v })}
                            />
                            {form.emojiThiefEnabled === 'on' && (
                                <div className="ml-12 p-4 rounded-lg bg-muted/30 border space-y-4">
                                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm font-medium">独立存储</Label>
                                            <p className="text-xs text-muted-foreground">本群表情包独立存储，不与其他群共享</p>
                                        </div>
                                        <Switch
                                            checked={form.emojiThiefSeparateFolder}
                                            onCheckedChange={v => setForm({ ...form, emojiThiefSeparateFolder: v })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <FormNumberInput
                                            label="最大收集数"
                                            min={10}
                                            max={5000}
                                            value={form.emojiThiefMaxCount}
                                            onChange={e => setForm({ ...form, emojiThiefMaxCount: parseInt(e.target.value) || 500 })}
                                        />
                                        <div className="flex items-end h-full pb-1">
                                            <ProbabilitySlider
                                                label="收集概率"
                                                value={form.emojiThiefStealRate}
                                                onChange={v => setForm({ ...form, emojiThiefStealRate: v })}
                                                className="w-full"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-xs">随机发图模式</Label>
                                            <Select
                                                value={form.emojiThiefTriggerMode}
                                                onValueChange={v => setForm({ ...form, emojiThiefTriggerMode: v })}
                                            >
                                                <SelectTrigger className="h-9">
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
                                        <div className="flex items-end h-full pb-1">
                                            <ProbabilitySlider
                                                label="发送概率"
                                                value={form.emojiThiefTriggerRate}
                                                onChange={v => setForm({ ...form, emojiThiefTriggerRate: v })}
                                                disabled={form.emojiThiefTriggerMode === 'off' || form.emojiThiefTriggerMode === 'chat_follow' || form.emojiThiefTriggerMode === 'bym_follow'}
                                                className="w-full"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground bg-muted/50 p-2 rounded">
                                        💡 触发模式100%发送，随机模式按概率发送。
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {form.eventEnabled !== 'off' && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Sparkles className="h-4 w-4" />
                                    事件配置
                                </CardTitle>
                                <p className="text-xs text-muted-foreground">每个事件可独立配置响应概率，开启后默认100%</p>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* 入群欢迎 */}
                                <EventConfig
                                    icon={<UserPlus className="h-4 w-4 text-green-500" />}
                                    title="入群欢迎"
                                    enabled={form.welcomeEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { welcomeEnabled: v }
                                        if (v === 'on' && form.welcomeProbability === 'inherit') {
                                            updates.welcomeProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.welcomeProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, welcomeProbability: v })}
                                >
                                    <Input
                                        value={form.welcomeMessage}
                                        onChange={e => setForm({ ...form, welcomeMessage: e.target.value })}
                                        placeholder="固定欢迎语（留空使用AI生成）"
                                        className="h-8 text-sm"
                                    />
                                    <Textarea
                                        value={form.welcomePrompt}
                                        onChange={e => setForm({ ...form, welcomePrompt: e.target.value })}
                                        placeholder="AI欢迎提示词"
                                        rows={2}
                                        className="text-sm"
                                    />
                                </EventConfig>

                                {/* 退群告别 */}
                                <EventConfig
                                    icon={<UserMinus className="h-4 w-4 text-red-500" />}
                                    title="退群告别"
                                    enabled={form.goodbyeEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { goodbyeEnabled: v }
                                        if (v === 'on' && form.goodbyeProbability === 'inherit') {
                                            updates.goodbyeProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.goodbyeProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, goodbyeProbability: v })}
                                >
                                    <Textarea
                                        value={form.goodbyePrompt}
                                        onChange={e => setForm({ ...form, goodbyePrompt: e.target.value })}
                                        placeholder="AI告别提示词"
                                        rows={2}
                                        className="text-sm"
                                    />
                                </EventConfig>

                                {/* 戳一戳 */}
                                <EventConfig
                                    icon={<MousePointer2 className="h-4 w-4 text-orange-500" />}
                                    title="戳一戳"
                                    enabled={form.pokeEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { pokeEnabled: v }
                                        if (v === 'on' && form.pokeProbability === 'inherit') {
                                            updates.pokeProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.pokeProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, pokeProbability: v })}
                                >
                                    <div className="flex items-center justify-between pt-2 border-t">
                                        <Label className="text-xs">戳回去</Label>
                                        <Switch
                                            checked={form.pokeBack}
                                            onCheckedChange={v => setForm({ ...form, pokeBack: v })}
                                        />
                                    </div>
                                </EventConfig>

                                {/* 撤回响应 */}
                                <EventConfig
                                    icon={<span className="text-sm">🔄</span>}
                                    title="撤回响应"
                                    enabled={form.recallEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { recallEnabled: v }
                                        if (v === 'on' && form.recallProbability === 'inherit') {
                                            updates.recallProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.recallProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, recallProbability: v })}
                                />

                                {/* 禁言响应 */}
                                <EventConfig
                                    icon={<span className="text-sm">🔇</span>}
                                    title="禁言响应"
                                    enabled={form.banEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { banEnabled: v }
                                        if (v === 'on' && form.banProbability === 'inherit') {
                                            updates.banProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.banProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, banProbability: v })}
                                />

                                {/* 运气王响应 */}
                                <EventConfig
                                    icon={<span className="text-sm">🧧</span>}
                                    title="运气王响应"
                                    enabled={form.luckyKingEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { luckyKingEnabled: v }
                                        if (v === 'on' && form.luckyKingProbability === 'inherit') {
                                            updates.luckyKingProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.luckyKingProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, luckyKingProbability: v })}
                                />

                                {/* 荣誉变更响应 */}
                                <EventConfig
                                    icon={<span className="text-sm">🏆</span>}
                                    title="荣誉变更"
                                    enabled={form.honorEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { honorEnabled: v }
                                        if (v === 'on' && form.honorProbability === 'inherit') {
                                            updates.honorProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.honorProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, honorProbability: v })}
                                />

                                {/* 精华消息响应 */}
                                <EventConfig
                                    icon={<span className="text-sm">⭐</span>}
                                    title="精华消息"
                                    enabled={form.essenceEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { essenceEnabled: v }
                                        if (v === 'on' && form.essenceProbability === 'inherit') {
                                            updates.essenceProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.essenceProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, essenceProbability: v })}
                                />

                                {/* 管理员变更响应 */}
                                <EventConfig
                                    icon={<span className="text-sm">👑</span>}
                                    title="管理员变更"
                                    enabled={form.adminEnabled}
                                    onEnabledChange={(v) => {
                                        const updates: Partial<typeof form> = { adminEnabled: v }
                                        if (v === 'on' && form.adminProbability === 'inherit') {
                                            updates.adminProbability = 1.0
                                        }
                                        setForm({ ...form, ...updates })
                                    }}
                                    probability={form.adminProbability}
                                    onProbabilityChange={(v) => setForm({ ...form, adminProbability: v })}
                                />
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* 伪人设置（含主动发言） */}
                <TabsContent value="bym" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Smile className="h-4 w-4" />
                                伪人模式
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">模拟真人聊天风格，随机参与群聊</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* 伪人开关 */}
                            <FeatureSwitch
                                icon={<Smile className="h-4 w-4 text-orange-500" />}
                                title="启用伪人"
                                desc="开启后机器人会随机回复群消息"
                                value={form.bymEnabled}
                                onChange={v => setForm({ ...form, bymEnabled: v })}
                            />

                            {form.bymEnabled !== 'off' && (
                                <div className="space-y-4 ml-4 pl-4 border-l-2 border-muted">
                                    {/* 伪人人设 */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <Label>伪人预设</Label>
                                            <Select
                                                value={form.bymPresetId || '__none__'}
                                                onValueChange={v => setForm({ ...form, bymPresetId: v === '__none__' ? '' : v })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="不使用预设" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">不使用预设</SelectItem>
                                                    {presets.map(p => (
                                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <ModelSelect
                                                label="伪人模型"
                                                value={form.bymModel}
                                                models={allModels}
                                                onChange={v => setForm({ ...form, bymModel: v })}
                                                placeholder="使用全局"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>伪人提示词</Label>
                                        <Textarea
                                            value={form.bymPrompt}
                                            onChange={e => setForm({ ...form, bymPrompt: e.target.value })}
                                            placeholder="自定义伪人人设（留空使用预设或全局）"
                                            rows={2}
                                        />
                                    </div>
                                    {/* 参数配置 */}
                                    <div className="grid grid-cols-4 gap-3">
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs">回复概率</Label>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-4 text-[10px] px-1"
                                                    onClick={() => setForm({ ...form, bymProbability: form.bymProbability === 'inherit' ? 0.02 : 'inherit' })}
                                                >
                                                    {form.bymProbability === 'inherit' ? '继承' : '自定义'}
                                                </Button>
                                            </div>
                                            {form.bymProbability !== 'inherit' && (
                                                <ProbabilitySlider
                                                    label=""
                                                    value={form.bymProbability as number}
                                                    onChange={(v) => setForm({ ...form, bymProbability: v })}
                                                    className="pt-1"
                                                />
                                            )}
                                            {form.bymProbability === 'inherit' && (
                                                <div className="text-xs text-muted-foreground h-8 flex items-center">使用全局设置</div>
                                            )}
                                        </div>
                                        <FormNumberInput
                                            label="温度"
                                            min={0}
                                            max={2}
                                            step={0.1}
                                            value={form.bymTemperature === 'inherit' ? '' : form.bymTemperature}
                                            onChange={e => setForm({
                                                ...form,
                                                bymTemperature: e.target.value === '' ? 'inherit' : Number(e.target.value)
                                            })}
                                            placeholder="继承"
                                        />
                                        <FormNumberInput
                                            label="最大Token"
                                            min={0}
                                            value={form.bymMaxTokens === 'inherit' ? '' : form.bymMaxTokens}
                                            onChange={e => setForm({
                                                ...form,
                                                bymMaxTokens: e.target.value === '' ? 'inherit' : Number(e.target.value)
                                            })}
                                            placeholder="继承"
                                        />
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
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <Label className="text-sm">使用表情</Label>
                                        <Switch
                                            checked={form.bymUseEmoji}
                                            onCheckedChange={v => setForm({ ...form, bymUseEmoji: v })}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* 主动发言 - 伪人扩展 */}
                            <FeatureSwitch
                                icon={<Clock className="h-4 w-4 text-blue-500" />}
                                title="主动发言"
                                desc="根据群聊内容主动参与讨论"
                                value={form.proactiveChatEnabled}
                                onChange={v => setForm({ ...form, proactiveChatEnabled: v })}
                            />

                            {form.proactiveChatEnabled !== 'off' && (
                                <div className="space-y-3 ml-4 pl-4 border-l-2 border-muted">
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs">触发概率</Label>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs px-2"
                                                    onClick={() => setForm({ ...form, proactiveChatProbability: form.proactiveChatProbability === 'inherit' ? 0.05 : 'inherit' })}
                                                >
                                                    {form.proactiveChatProbability === 'inherit' ? '继承' : '自定义'}
                                                </Button>
                                            </div>
                                            {form.proactiveChatProbability !== 'inherit' && (
                                                <ProbabilitySlider
                                                    label=""
                                                    value={form.proactiveChatProbability as number}
                                                    onChange={(v) => setForm({ ...form, proactiveChatProbability: v })}
                                                    className="pt-1"
                                                />
                                            )}
                                        </div>
                                        <FormNumberInput
                                            label="冷却时间(秒)"
                                            min={0}
                                            value={form.proactiveChatCooldown === 'inherit' ? '' : form.proactiveChatCooldown}
                                            onChange={e => setForm({
                                                ...form,
                                                proactiveChatCooldown: e.target.value === '' ? 'inherit' : Number(e.target.value)
                                            })}
                                            placeholder="继承"
                                        />
                                        <FormNumberInput
                                            label="每日上限"
                                            min={0}
                                            value={form.proactiveChatMaxDaily === 'inherit' ? '' : form.proactiveChatMaxDaily}
                                            onChange={e => setForm({
                                                ...form,
                                                proactiveChatMaxDaily: e.target.value === '' ? 'inherit' : Number(e.target.value)
                                            })}
                                            placeholder="继承"
                                        />
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 pt-2 border-t">
                                        <FormNumberInput
                                            label="最少消息数"
                                            min={1}
                                            value={form.proactiveChatMinMessages}
                                            onChange={e => setForm({ ...form, proactiveChatMinMessages: parseInt(e.target.value) || 5 })}
                                        />
                                        <FormNumberInput
                                            label="开始时间"
                                            min={0}
                                            max={23}
                                            value={form.proactiveChatTimeStart}
                                            onChange={e => setForm({ ...form, proactiveChatTimeStart: parseInt(e.target.value) || 8 })}
                                        />
                                        <FormNumberInput
                                            label="结束时间"
                                            min={0}
                                            max={23}
                                            value={form.proactiveChatTimeEnd}
                                            onChange={e => setForm({ ...form, proactiveChatTimeEnd: parseInt(e.target.value) || 23 })}
                                        />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* 游戏模式 */}
                <TabsContent value="game" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Gamepad2 className="h-4 w-4 text-green-500" />
                                游戏模式
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">Galgame等互动游戏的群组独立配置</p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <ProbabilitySlider
                                    label="触发概率"
                                    value={form.gameProbability}
                                    onChange={v => setForm({ ...form, gameProbability: v })}
                                />
                                <div className="space-y-1">
                                    <Label className="text-xs">游戏模型</Label>
                                    <Select value={form.gameModel || '__inherit__'} onValueChange={v => setForm({ ...form, gameModel: v === '__inherit__' ? '' : v })}>
                                        <SelectTrigger><SelectValue placeholder="继承全局" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__inherit__">继承全局</SelectItem>
                                            {allModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormNumberInput
                                    label="温度"
                                    min={0}
                                    max={2}
                                    step={0.1}
                                    value={form.gameTemperature === 'inherit' ? '' : form.gameTemperature}
                                    onChange={e => setForm({ ...form, gameTemperature: e.target.value ? parseFloat(e.target.value) : 'inherit' })}
                                    placeholder="继承"
                                />
                                <FormNumberInput
                                    label="最大Token"
                                    min={100}
                                    max={8000}
                                    value={form.gameMaxTokens === 'inherit' ? '' : form.gameMaxTokens}
                                    onChange={e => setForm({ ...form, gameMaxTokens: e.target.value ? parseInt(e.target.value) : 'inherit' })}
                                    placeholder="继承"
                                />
                            </div>
                            <FeatureSwitch
                                icon={<Zap className="h-4 w-4 text-yellow-500" />}
                                title="启用工具"
                                desc="允许游戏模式使用MCP工具"
                                value={form.gameEnableTools}
                                onChange={v => setForm({ ...form, gameEnableTools: v })}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* 渠道与限制 */}
                <TabsContent value="channel" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Server className="h-4 w-4" />
                                    群独立渠道
                                </CardTitle>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        setEditingChannelIndex(null)
                                        setChannelForm({
                                            name: `渠道${form.independentChannels.length + 1}`,
                                            baseUrl: '',
                                            apiKey: '',
                                            adapterType: 'openai',
                                            models: '',
                                            enabled: true,
                                            priority: form.independentChannels.length,
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
                                    <Plus className="h-4 w-4 mr-1" />
                                    添加渠道
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                为本群配置独立的API渠道，支持多个渠道和获取模型列表
                            </p>
                            
                            {/* 禁用全局渠道开关 */}
                            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-md bg-orange-500/10">
                                        <Server className="h-4 w-4 text-orange-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">强制使用本群渠道</p>
                                        <p className="text-xs text-muted-foreground">开启后本群将完全隔离全局模型，仅使用下方独立配置</p>
                                    </div>
                                </div>
                                <Switch
                                    checked={form.forbidGlobalModel}
                                    onCheckedChange={v => setForm({ ...form, forbidGlobalModel: v })}
                                />
                            </div>

                            {/* 渠道列表 */}
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
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-1 truncate">
                                                        {channel.baseUrl || '使用默认地址'}
                                                    </p>
                                                    {channel.models.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-2">
                                                            {channel.models.slice(0, 3).map(m => (
                                                                <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                                                            ))}
                                                            {channel.models.length > 3 && (
                                                                <Badge variant="outline" className="text-xs">
                                                                    +{channel.models.length - 3}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => {
                                                            setEditingChannelIndex(index)
                                                            setChannelForm({
                                                                name: channel.name,
                                                                baseUrl: channel.baseUrl,
                                                                apiKey: channel.apiKey,
                                                                adapterType: channel.adapterType,
                                                                models: channel.models.join(', '),
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
                                                        className="h-8 w-8 text-destructive"
                                                        onClick={() => {
                                                            setForm({
                                                                ...form,
                                                                independentChannels: form.independentChannels.filter((_, i) => i !== index)
                                                            })
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
                        </CardContent>
                    </Card>

                    {/* 渠道编辑对话框 - 使用统一的 ChannelDialog 组件 */}
                    <ChannelDialog
                        open={channelDialogOpen}
                        onOpenChange={setChannelDialogOpen}
                        channelForm={channelForm}
                        onChannelFormChange={setChannelForm}
                        isEditing={editingChannelIndex !== null}
                        onSave={() => {
                            if (!channelForm.name) {
                                toast.error('请填写渠道名称')
                                return
                            }
                            const newChannel: IndependentChannel = {
                                id: editingChannelIndex !== null 
                                    ? form.independentChannels[editingChannelIndex].id 
                                    : `ch_${Date.now()}`,
                                name: channelForm.name,
                                baseUrl: channelForm.baseUrl,
                                apiKey: channelForm.apiKey,
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
                            if (editingChannelIndex !== null) {
                                const channels = [...form.independentChannels]
                                channels[editingChannelIndex] = newChannel
                                setForm({ ...form, independentChannels: channels })
                            } else {
                                setForm({ ...form, independentChannels: [...form.independentChannels, newChannel] })
                            }
                            setChannelDialogOpen(false)
                            toast.success(editingChannelIndex !== null ? '渠道已更新' : '渠道已添加')
                        }}
                        onFetchModels={async () => {
                            if (!channelForm.apiKey) {
                                toast.error('请先填写 API Key')
                                return
                            }
                            try {
                                const res = await channelsApi.fetchModels({
                                    adapterType: channelForm.adapterType,
                                    baseUrl: channelForm.baseUrl || '',
                                    apiKey: channelForm.apiKey
                                }) as { data?: { models?: unknown[] }; models?: unknown[] }
                                const models = res?.data?.models || res?.models || []
                                if (Array.isArray(models) && models.length > 0) {
                                    const modelIds = models
                                        .map((m: unknown) =>
                                            typeof m === 'string' ? m : (m as Record<string, string>)?.id || (m as Record<string, string>)?.name
                                        )
                                        .filter(Boolean)
                                    toast.success(`获取到 ${modelIds.length} 个模型`)
                                    return modelIds
                                } else {
                                    toast.error('未获取到模型列表')
                                    return []
                                }
                            } catch (error: unknown) {
                                const err = error as { response?: { data?: { message?: string } } }
                                toast.error(err.response?.data?.message || '获取模型失败')
                                return []
                            }
                        }}
                    />

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Gauge className="h-4 w-4" />
                                使用限制
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                设置本群每日使用次数限制（0表示无限制）
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>群每日限制</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={form.dailyGroupLimit}
                                        onChange={e => setForm({ ...form, dailyGroupLimit: parseInt(e.target.value) || 0 })}
                                        placeholder="0 = 无限制"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>用户每日限制</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={form.dailyUserLimit}
                                        onChange={e => setForm({ ...form, dailyUserLimit: parseInt(e.target.value) || 0 })}
                                        placeholder="0 = 无限制"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>达到限制时的提示</Label>
                                <Textarea
                                    value={form.usageLimitMessage}
                                    onChange={e => setForm({ ...form, usageLimitMessage: e.target.value })}
                                    placeholder="今日使用次数已达上限，请明天再试"
                                    rows={2}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* 高级设置 */}
                <TabsContent value="advanced" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Bot className="h-4 w-4" />
                                模型配置
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                为本群配置各场景独立模型（留空使用全局配置）
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                <ModelSelect
                                    label="对话模型"
                                    value={form.chatModel}
                                    models={allModels}
                                    onChange={v => setForm({ ...form, chatModel: v })}
                                />
                                <ModelSelect
                                    label="总结模型"
                                    value={form.summaryModel}
                                    models={allModels}
                                    onChange={v => setForm({ ...form, summaryModel: v })}
                                />
                                <ModelSelect
                                    label="伪人模型"
                                    value={form.bymModel}
                                    models={allModels}
                                    onChange={v => setForm({ ...form, bymModel: v })}
                                />
                                <ModelSelect
                                    label="绘图模型"
                                    value={form.imageGenModel}
                                    models={allModels}
                                    onChange={v => setForm({ ...form, imageGenModel: v })}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <BookOpen className="h-4 w-4" />
                                群组知识库
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <p className="text-sm text-muted-foreground">为本群配置专属知识库</p>
                            {form.knowledgeIds.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {form.knowledgeIds.map(kId => {
                                        const doc = knowledgeDocs.find(d => d.id === kId)
                                        return (
                                            <Badge key={kId} variant="secondary" className="gap-1">
                                                {doc?.name || kId}
                                                <button onClick={() => setForm({
                                                    ...form,
                                                    knowledgeIds: form.knowledgeIds.filter(id => id !== kId)
                                                })}>
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        )
                                    })}
                                </div>
                            )}
                            <Select
                                value="__placeholder__"
                                onValueChange={v => v && v !== '__placeholder__' && !form.knowledgeIds.includes(v) && setForm({
                                    ...form,
                                    knowledgeIds: [...form.knowledgeIds, v]
                                })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="添加知识库..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {knowledgeDocs.filter(d => !form.knowledgeIds.includes(d.id)).map(doc => (
                                        <SelectItem key={doc.id} value={doc.id}>{doc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </CardContent>
                    </Card>
                </TabsContent>
                </div>
            </Tabs>
        </div>
    )
}
