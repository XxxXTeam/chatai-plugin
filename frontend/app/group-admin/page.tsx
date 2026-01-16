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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
    Cpu,
    Smile,
    Hash,
    ToggleLeft
} from 'lucide-react'

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
    welcomeEnabled?: boolean | string
    welcomeMessage?: string
    welcomePrompt?: string
    goodbyeEnabled?: boolean | string
    goodbyePrompt?: string
    pokeEnabled?: boolean | string
    pokeBack?: boolean
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
    summaryPush: {
        enabled: boolean
        intervalType: 'day' | 'hour'
        intervalValue: number
        pushHour?: number
        messageCount?: number
    }
    knowledgeIds?: string[]
    presets: Preset[]
    channels: Channel[]
    knowledgeBases?: { id: string; name: string }[]
    proactiveChatEnabled?: boolean
    proactiveChatProbability?: number
    proactiveChatCooldown?: number
    proactiveChatMaxDaily?: number
}

export default function GroupAdminPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [groupId, setGroupId] = useState<string>('')
    const [error, setError] = useState<string>('')
    const [formTab, setFormTab] = useState('basic')

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
        goodbyeEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        goodbyePrompt: '',
        pokeEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        pokeBack: false,
        // 知识库
        knowledgeIds: [] as string[],
        // 主动聊天
        proactiveChatEnabled: 'inherit' as 'inherit' | 'on' | 'off',
        proactiveChatProbability: 'inherit' as 'inherit' | number,
        proactiveChatCooldown: 'inherit' as 'inherit' | number,
        proactiveChatMaxDaily: 'inherit' as 'inherit' | number
    })

    const [knowledgeBases, setKnowledgeBases] = useState<{ id: string; name: string }[]>([])
    const [presets, setPresets] = useState<Preset[]>([])
    const [allModels, setAllModels] = useState<string[]>([])

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
                    summaryPushEnabled: c.summaryPush?.enabled || false,
                    summaryPushIntervalType: c.summaryPush?.intervalType || 'day',
                    summaryPushIntervalValue: c.summaryPush?.intervalValue || 1,
                    summaryPushHour: c.summaryPush?.pushHour ?? 20,
                    summaryPushMessageCount: c.summaryPush?.messageCount || 100,
                    // 事件处理扩展
                    welcomeEnabled:
                        c.welcomeEnabled === undefined ? 'inherit' : c.welcomeEnabled === true ? 'on' : 'off',
                    welcomeMessage: c.welcomeMessage || '',
                    welcomePrompt: c.welcomePrompt || '',
                    goodbyeEnabled:
                        c.goodbyeEnabled === undefined ? 'inherit' : c.goodbyeEnabled === true ? 'on' : 'off',
                    goodbyePrompt: c.goodbyePrompt || '',
                    pokeEnabled: c.pokeEnabled === undefined ? 'inherit' : c.pokeEnabled === true ? 'on' : 'off',
                    pokeBack: c.pokeBack || false,
                    knowledgeIds: c.knowledgeIds || [],
                    // 主动聊天
                    proactiveChatEnabled:
                        c.proactiveChatEnabled === undefined
                            ? 'inherit'
                            : c.proactiveChatEnabled === true
                              ? 'on'
                              : 'off',
                    proactiveChatProbability:
                        c.proactiveChatProbability === undefined ? 'inherit' : c.proactiveChatProbability,
                    proactiveChatCooldown: c.proactiveChatCooldown === undefined ? 'inherit' : c.proactiveChatCooldown,
                    proactiveChatMaxDaily: c.proactiveChatMaxDaily === undefined ? 'inherit' : c.proactiveChatMaxDaily
                })
                // 设置知识库列表
                if (c.knowledgeBases) setKnowledgeBases(c.knowledgeBases)
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
                        maxTokens: form.bymMaxTokens === 'inherit' ? undefined : form.bymMaxTokens
                    },
                    models: {
                        chat: form.chatModel || undefined,
                        summary: form.summaryModel || undefined
                    },
                    listMode: form.listMode,
                    blacklist: form.blacklist,
                    whitelist: form.whitelist,
                    summaryPush: {
                        enabled: form.summaryPushEnabled,
                        intervalType: form.summaryPushIntervalType,
                        intervalValue: form.summaryPushIntervalValue,
                        pushHour: form.summaryPushHour,
                        messageCount: form.summaryPushMessageCount
                    },
                    // 事件处理扩展
                    welcomeEnabled: form.welcomeEnabled === 'inherit' ? undefined : form.welcomeEnabled === 'on',
                    welcomeMessage: form.welcomeMessage || undefined,
                    welcomePrompt: form.welcomePrompt || undefined,
                    goodbyeEnabled: form.goodbyeEnabled === 'inherit' ? undefined : form.goodbyeEnabled === 'on',
                    goodbyePrompt: form.goodbyePrompt || undefined,
                    pokeEnabled: form.pokeEnabled === 'inherit' ? undefined : form.pokeEnabled === 'on',
                    pokeBack: form.pokeBack,
                    knowledgeIds: form.knowledgeIds.length > 0 ? form.knowledgeIds : undefined,
                    // 主动聊天
                    proactiveChatEnabled:
                        form.proactiveChatEnabled === 'inherit' ? undefined : form.proactiveChatEnabled === 'on',
                    proactiveChatProbability:
                        form.proactiveChatProbability === 'inherit' ? undefined : form.proactiveChatProbability,
                    proactiveChatCooldown:
                        form.proactiveChatCooldown === 'inherit' ? undefined : form.proactiveChatCooldown,
                    proactiveChatMaxDaily:
                        form.proactiveChatMaxDaily === 'inherit' ? undefined : form.proactiveChatMaxDaily
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
                            <TabsList className="grid w-full grid-cols-4 mb-4">
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
                                <TabsTrigger value="proactive">
                                    <MessageSquare className="h-4 w-4 mr-1 hidden sm:inline" />
                                    主动
                                </TabsTrigger>
                                <TabsTrigger value="advanced">
                                    <BookOpen className="h-4 w-4 mr-1 hidden sm:inline" />
                                    高级
                                </TabsTrigger>
                            </TabsList>

                            <ScrollArea className="h-[60vh] pr-4">
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
                                        <ModelSubSelect
                                            label="绘图模型"
                                            value={form.imageGenModel}
                                            models={allModels}
                                            onChange={v => setForm({ ...form, imageGenModel: v })}
                                        />
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
                                                    <div className="space-y-2 pl-6">
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
                                                    <div className="space-y-1 pl-6">
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
                                                    <div className="flex items-center gap-2 pl-6">
                                                        <Switch
                                                            checked={form.pokeBack}
                                                            onCheckedChange={v => setForm({ ...form, pokeBack: v })}
                                                        />
                                                        <Label className="text-xs">戳回去（而非文字回复）</Label>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <FeatureItem
                                        icon={<Palette className="h-4 w-4" />}
                                        title="表情小偷"
                                        desc="收集并发送表情包"
                                        value={form.emojiThiefEnabled}
                                        onChange={v => setForm({ ...form, emojiThiefEnabled: v })}
                                    />
                                    {form.emojiThiefEnabled !== 'off' && (
                                        <div className="ml-4 pl-4 border-l-2 border-muted space-y-3">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-sm">独立存储</Label>
                                                <Switch
                                                    checked={form.emojiThiefSeparateFolder}
                                                    onCheckedChange={v =>
                                                        setForm({ ...form, emojiThiefSeparateFolder: v })
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">最大数量</Label>
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
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">偷取概率 (%)</Label>
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
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="off">关闭</SelectItem>
                                                            <SelectItem value="chat_follow">聊天触发</SelectItem>
                                                            <SelectItem value="chat_random">聊天随机</SelectItem>
                                                            <SelectItem value="bym_follow">伪人触发</SelectItem>
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
                                                        disabled={
                                                            form.emojiThiefTriggerMode === 'off' ||
                                                            form.emojiThiefTriggerMode === 'chat_follow' ||
                                                            form.emojiThiefTriggerMode === 'bym_follow'
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                触发模式100%发送，随机模式按概率发送
                                            </p>
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
                                        </div>
                                    )}
                                </TabsContent>

                                {/* 主动聊天 */}
                                <TabsContent value="proactive" className="space-y-4 mt-0">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label>主动聊天</Label>
                                                <p className="text-xs text-muted-foreground">
                                                    允许机器人在本群主动发言
                                                </p>
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
                                                <SelectTrigger className="w-28">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="inherit">继承全局</SelectItem>
                                                    <SelectItem value="on">启用</SelectItem>
                                                    <SelectItem value="off">禁用</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {form.proactiveChatEnabled !== 'off' && (
                                            <>
                                                <div className="space-y-2">
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
                                                            <SelectItem value="inherit">继承全局设置</SelectItem>
                                                            <SelectItem value="0.01">1%</SelectItem>
                                                            <SelectItem value="0.02">2%</SelectItem>
                                                            <SelectItem value="0.05">5%</SelectItem>
                                                            <SelectItem value="0.1">10%</SelectItem>
                                                            <SelectItem value="0.15">15%</SelectItem>
                                                            <SelectItem value="0.2">20%</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs">冷却时间（分钟）</Label>
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
                                                            <SelectItem value="inherit">继承全局设置</SelectItem>
                                                            <SelectItem value="10">10分钟</SelectItem>
                                                            <SelectItem value="30">30分钟</SelectItem>
                                                            <SelectItem value="60">1小时</SelectItem>
                                                            <SelectItem value="120">2小时</SelectItem>
                                                            <SelectItem value="360">6小时</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs">每日最大次数</Label>
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
                                                            <SelectItem value="inherit">继承全局设置</SelectItem>
                                                            <SelectItem value="5">5次</SelectItem>
                                                            <SelectItem value="10">10次</SelectItem>
                                                            <SelectItem value="20">20次</SelectItem>
                                                            <SelectItem value="50">50次</SelectItem>
                                                            <SelectItem value="100">100次</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </>
                                        )}
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

                                        <div className="space-y-3">
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
