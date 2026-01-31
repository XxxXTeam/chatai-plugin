'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { configApi, channelsApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
    Sparkles,
    Plug,
    Bot,
    MessageSquare,
    CheckCircle2,
    ChevronRight,
    ChevronLeft,
    Loader2,
    Zap,
    ExternalLink,
    Info,
    Rocket,
    User,
    Wand2
} from 'lucide-react'

interface SetupWizardProps {
    onComplete?: () => void
    forceShow?: boolean
}

interface PresetItem {
    id: string
    name: string
    description?: string
    systemPromptPreview?: string
}

interface ChannelPreset {
    name: string
    adapterType: string
    baseUrl: string
    apiKey: string
    models: string
    description: string
    authUrl?: string
}

const QUICK_PRESETS: Record<string, ChannelPreset> = {
    'free-glm': {
        name: '免费GLM',
        adapterType: 'openai',
        baseUrl: 'https://glm.openel.top/',
        apiKey: 'sk-3d2f9b84e7f510b1a08f7b3d6c9a6a7f17fbbad5624ea29f22d9c742bf39c863',
        models: 'GLM-4.5, GLM-4.5-thinking, GLM-4.6, GLM-4.6-thinking',
        description: '免费智谱GLM API，无需注册'
    },
    'free-xiaomi': {
        name: '免费小米MiMo',
        adapterType: 'openai',
        baseUrl: 'https://xiaomi.openel.top/',
        apiKey: 'sk-3d2f9b84e7f510b1a08f7b3d6c9a6a7f17fbbad5624ea29f22d9c742bf39c863',
        models: 'mimo-v2-flash, mimo-v2-flash-thinking',
        description: '免费小米MiMo API，无需注册'
    },
    'free-api': {
        name: '免费多模型',
        adapterType: 'openai',
        baseUrl: 'https://ai.openel.top/',
        apiKey: 'sk-LnATx3JUr565w2Kmme1r5om3WkO2YAsglOPaVael6UfgswXj',
        models: '',
        description: '免费多模型API，支持多种模型'
    },
    openai: {
        name: 'OpenAI',
        adapterType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        models: 'gpt-4o, gpt-4o-mini, o1, o1-mini',
        description: 'OpenAI官方API，需要API Key'
    },
    deepseek: {
        name: 'DeepSeek',
        adapterType: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        models: 'deepseek-chat, deepseek-reasoner',
        description: 'DeepSeek官方API，性价比高'
    },
    siliconflow: {
        name: '硅基流动',
        adapterType: 'openai',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        models: 'deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-72B-Instruct',
        description: '国内中转，支持多模型'
    },
    zhipu: {
        name: '智谱AI',
        adapterType: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: '',
        models: 'glm-4.5, glm-4.5-air, glm-4.6, glm-4.7',
        description: '智谱AI官方API'
    },
    'free-zhipu': {
        name: '免费智谱视频',
        adapterType: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'a1eef00f6bce4a10a7de83936fce6492.0wDYtwPnWukoPxWj',
        models: 'glm-4.5, glm-4.5-air, glm-4.6, glm-4.7, glm-4.1v-thinking-flash',
        description: '免费智谱API，支持视频分析'
    }
}

const STEPS = [
    { id: 'welcome', title: '欢迎', icon: Sparkles, description: '了解 ChatAI', required: false },
    { id: 'channel', title: '配置渠道', icon: Plug, description: '连接 AI 服务', required: true },
    { id: 'model', title: '选择模型', icon: Bot, description: '设置默认模型', required: true },
    { id: 'preset', title: 'AI人格', icon: User, description: '选择预设人格', required: false },
    { id: 'trigger', title: '触发设置', icon: MessageSquare, description: '配置触发方式', required: false },
    { id: 'complete', title: '完成', icon: CheckCircle2, description: '开始使用', required: false }
]

// 内置预设模板 - 用于首次使用时快速选择
const BUILTIN_PRESETS = [
    {
        id: 'assistant',
        name: '智能助手',
        description: '通用AI助手，擅长解答问题、提供建议',
        icon: Bot,
        color: 'blue'
    },
    {
        id: 'catgirl',
        name: '猫娘',
        description: '可爱的猫娘角色，活泼俏皮的对话风格',
        icon: Sparkles,
        color: 'pink'
    },
    {
        id: 'custom',
        name: '自定义人格',
        description: '自己编写系统提示词，打造专属AI',
        icon: Wand2,
        color: 'purple'
    }
]

export function SetupWizard({ onComplete, forceShow = false }: SetupWizardProps) {
    const [open, setOpen] = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Form state
    const [selectedChannelPreset, setSelectedChannelPreset] = useState<string>('')
    const [channelForm, setChannelForm] = useState({
        name: '',
        adapterType: 'openai',
        baseUrl: '',
        apiKey: '',
        models: ''
    })
    const [defaultModel, setDefaultModel] = useState('')
    const [triggerPrefixes, setTriggerPrefixes] = useState(['#chat'])
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [fetchingModels, setFetchingModels] = useState(false)
    const [testingConnection, setTestingConnection] = useState(false)
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [connectionError, setConnectionError] = useState('')
    
    // Preset selection state
    const [existingPresets, setExistingPresets] = useState<PresetItem[]>([])
    const [selectedPresetType, setSelectedPresetType] = useState<'builtin' | 'existing' | 'custom'>('builtin')
    const [selectedBuiltinPreset, setSelectedBuiltinPreset] = useState<string>('assistant')
    const [selectedExistingPreset, setSelectedExistingPreset] = useState<string>('')
    const [customSystemPrompt, setCustomSystemPrompt] = useState('')
    const [loadingPresets, setLoadingPresets] = useState(false)

    /**
     * @description 检查初始化引导状态
     * 每次进入页面时调用后端API判断是否已完成引导：
     * - 如果 initCompleted 为 false，显示引导向导
     * - 如果 forceShow 为 true，强制显示引导（用于手动触发）
     * - 完成引导后调用 configApi.completeInit() 标记状态为已完成
     */
    const checkInitStatus = useCallback(async () => {
        try {
            const res = (await configApi.getInitStatus()) as {
                data?: { 
                    initCompleted?: boolean
                    hasChannels?: boolean
                    hasDefaultModel?: boolean
                    hasPresets?: boolean
                }
            }
            const status = res?.data
            
            // 判断是否需要显示引导向导
            // 优先级：forceShow > initCompleted 状态
            const isInitCompleted = status?.initCompleted === true
            const shouldShowWizard = forceShow || !isInitCompleted
            
            if (shouldShowWizard) {
                setOpen(true)
                // 同时获取已有预设列表供选择
                fetchExistingPresets()
            }
        } catch (error) {
            console.error('[SetupWizard] 检查初始化状态失败:', error)
            // API请求失败时，仅在强制显示模式下展示向导
            if (forceShow) {
                setOpen(true)
                fetchExistingPresets()
            }
        } finally {
            setLoading(false)
        }
    }, [forceShow])

    const fetchExistingPresets = async () => {
        setLoadingPresets(true)
        try {
            const res = await presetsApi.list() as { data?: PresetItem[] } | PresetItem[]
            const presets = Array.isArray(res) ? res : (res?.data || [])
            setExistingPresets(presets)
        } catch (error) {
            console.error('Failed to fetch presets:', error)
        } finally {
            setLoadingPresets(false)
        }
    }

    useEffect(() => {
        checkInitStatus()
    }, [checkInitStatus])

    const handleChannelPresetSelect = (presetId: string) => {
        setSelectedChannelPreset(presetId)
        const preset = QUICK_PRESETS[presetId]
        if (preset) {
            setChannelForm({
                name: preset.name,
                adapterType: preset.adapterType,
                baseUrl: preset.baseUrl,
                apiKey: preset.apiKey,
                models: preset.models
            })
            // Set first model as default
            const models = preset.models.split(',').map(m => m.trim()).filter(Boolean)
            if (models.length > 0) {
                setDefaultModel(models[0])
                setAvailableModels(models)
            }
        }
    }

    /**
     * @description 测试渠道连接是否正常
     */
    const handleTestConnection = async () => {
        if (!channelForm.baseUrl) {
            toast.error('请先选择或填写渠道')
            return
        }
        if (!channelForm.apiKey && !channelForm.baseUrl.includes('openel')) {
            toast.error('请先填写API Key')
            return
        }
        setTestingConnection(true)
        setConnectionStatus('idle')
        setConnectionError('')
        try {
            const res = (await channelsApi.test({
                adapterType: channelForm.adapterType,
                baseUrl: channelForm.baseUrl,
                apiKey: channelForm.apiKey
            })) as { success?: boolean; error?: string }
            if (res?.success) {
                setConnectionStatus('success')
                toast.success('连接测试成功')
            } else {
                setConnectionStatus('error')
                setConnectionError(res?.error || '连接失败')
                toast.error(res?.error || '连接测试失败')
            }
        } catch (error) {
            setConnectionStatus('error')
            const errMsg = error instanceof Error ? error.message : '连接测试失败'
            setConnectionError(errMsg)
            toast.error(errMsg)
        } finally {
            setTestingConnection(false)
        }
    }

    /**
     * @description 获取渠道可用模型列表
     */
    const handleFetchModels = async () => {
        if (!channelForm.apiKey && !channelForm.baseUrl.includes('openel')) {
            toast.error('请先填写API Key')
            return
        }
        setFetchingModels(true)
        try {
            const res = (await channelsApi.fetchModels({
                adapterType: channelForm.adapterType,
                baseUrl: channelForm.baseUrl,
                apiKey: channelForm.apiKey
            })) as { data?: { models?: string[] }; models?: string[] }
            const models = res?.data?.models || res?.models || []
            if (models.length > 0) {
                setAvailableModels(models)
                if (!defaultModel && models.length > 0) {
                    setDefaultModel(models[0])
                }
                setConnectionStatus('success')
                toast.success(`获取到 ${models.length} 个模型`)
            } else {
                toast.error('未获取到模型列表，请手动输入模型名称')
            }
        } catch (error) {
            console.error('Failed to fetch models:', error)
            toast.error('获取模型失败，请手动输入模型名称')
        } finally {
            setFetchingModels(false)
        }
    }

    /**
     * @description 验证当前步骤是否已完成必填项
     */
    const validateCurrentStep = (): { valid: boolean; message?: string } => {
        switch (currentStep) {
            case 1: // 渠道配置
                if (!channelForm.baseUrl) {
                    return { valid: false, message: '请选择一个渠道预设' }
                }
                if (!channelForm.apiKey && !channelForm.baseUrl.includes('openel')) {
                    return { valid: false, message: '请填写API Key' }
                }
                return { valid: true }
            case 2: // 模型选择
                if (!defaultModel) {
                    return { valid: false, message: '请选择或输入默认模型' }
                }
                return { valid: true }
            default:
                return { valid: true }
        }
    }

    const handleNext = () => {
        const validation = validateCurrentStep()
        if (!validation.valid) {
            toast.error(validation.message || '请完成必填项')
            return
        }
        if (currentStep < STEPS.length - 1) {
            setCurrentStep(currentStep + 1)
        }
    }

    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1)
        }
    }

    /**
     * @description 完成引导向导
     * 保存所有配置后调用 completeInit 标记引导状态为已完成
     */
    const handleComplete = async () => {
        setSaving(true)
        try {
            // 1. 创建渠道配置
            if (channelForm.baseUrl && (channelForm.apiKey || channelForm.baseUrl.includes('openel'))) {
                await channelsApi.create({
                    name: channelForm.name || '默认渠道',
                    adapterType: channelForm.adapterType,
                    baseUrl: channelForm.baseUrl,
                    apiKey: channelForm.apiKey,
                    models: channelForm.models.split(',').map(m => m.trim()).filter(Boolean),
                    enabled: true,
                    priority: 0
                })
            }

            // 2. 创建或设置预设
            if (selectedPresetType === 'builtin' && selectedBuiltinPreset === 'custom' && customSystemPrompt.trim()) {
                await presetsApi.create({
                    name: '自定义人格',
                    systemPrompt: customSystemPrompt.trim(),
                    isDefault: true
                })
            } else if (selectedPresetType === 'existing' && selectedExistingPreset) {
                await presetsApi.setDefault(selectedExistingPreset)
            }

            // 3. 保存基础配置
            const configUpdate: Record<string, unknown> = {
                llm: { defaultModel },
                trigger: { prefixes: triggerPrefixes }
            }
            
            if (selectedPresetType === 'existing' && selectedExistingPreset) {
                configUpdate.presets = { defaultPresetId: selectedExistingPreset }
            }

            await configApi.update(configUpdate)

            // 4. 标记引导已完成（关键步骤）
            await configApi.completeInit()

            toast.success('配置完成！下次进入将不再显示引导向导')
            setOpen(false)
            onComplete?.()
        } catch (error) {
            console.error('[SetupWizard] 保存配置失败:', error)
            toast.error('保存配置失败，请重试')
        } finally {
            setSaving(false)
        }
    }

    /**
     * @description 跳过引导向导
     * 跳过时也标记为已完成，下次进入不再显示
     */
    const handleSkip = async () => {
        try {
            // 标记引导已完成，下次不再显示
            await configApi.completeInit()
            toast.info('已跳过引导，可通过设置重新打开')
            setOpen(false)
            onComplete?.()
        } catch (error) {
            console.error('[SetupWizard] 跳过引导失败:', error)
            setOpen(false)
        }
    }

    const progress = ((currentStep + 1) / STEPS.length) * 100

    if (loading) return null

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-2xl h-[600px] flex flex-col">
                <DialogHeader className="pb-2 shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Rocket className="h-5 w-5 text-primary" />
                        ChatAI 初始配置向导
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        配置您的 AI 聊天插件
                    </DialogDescription>
                </DialogHeader>

                {/* Step Indicators */}
                <div className="flex items-center justify-center gap-1 py-2 shrink-0">
                    {STEPS.map((step, index) => {
                        const StepIcon = step.icon
                        const isCompleted = index < currentStep
                        const isCurrent = index === currentStep
                        return (
                            <div key={step.id} className="flex items-center">
                                <div 
                                    className={cn(
                                        'flex items-center justify-center w-8 h-8 rounded-full transition-all',
                                        isCompleted && 'bg-primary text-primary-foreground',
                                        isCurrent && 'bg-primary/20 text-primary ring-2 ring-primary',
                                        !isCompleted && !isCurrent && 'bg-muted text-muted-foreground'
                                    )}
                                    title={step.title}
                                >
                                    {isCompleted ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                    ) : (
                                        <StepIcon className="h-4 w-4" />
                                    )}
                                </div>
                                {index < STEPS.length - 1 && (
                                    <div className={cn(
                                        'w-6 h-0.5 mx-1',
                                        index < currentStep ? 'bg-primary' : 'bg-muted'
                                    )} />
                                )}
                            </div>
                        )
                    })}
                </div>

                <div className="text-center text-sm text-muted-foreground pb-2 shrink-0">
                    <span className="font-medium text-foreground">{STEPS[currentStep].title}</span>
                    <span className="mx-2">·</span>
                    <span>{STEPS[currentStep].description}</span>
                </div>

                <Progress value={progress} className="h-1 shrink-0" />

                <ScrollArea className="flex-1 min-h-0 overflow-y-auto pr-4">
                    {/* Step 0: Welcome */}
                    {currentStep === 0 && (
                        <div className="space-y-4 py-4">
                            <div className="text-center space-y-4">
                                <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                                    <Sparkles className="h-8 w-8 text-primary" />
                                </div>
                                <h3 className="text-xl font-semibold">欢迎使用 ChatAI Plugin</h3>
                                <p className="text-muted-foreground max-w-md mx-auto">
                                    这是一个功能强大的 AI 聊天插件，支持多种大语言模型、工具调用、长期记忆等高级功能。
                                </p>
                            </div>

                            <div className="grid gap-3 mt-6">
                                <Card className="border-primary/20">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <Plug className="h-5 w-5 text-primary" />
                                        <div>
                                            <div className="font-medium">配置 API 渠道</div>
                                            <div className="text-sm text-muted-foreground">连接到 AI 服务提供商</div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-primary/20">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <Bot className="h-5 w-5 text-primary" />
                                        <div>
                                            <div className="font-medium">选择默认模型</div>
                                            <div className="text-sm text-muted-foreground">设置 AI 对话使用的模型</div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-primary/20">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <User className="h-5 w-5 text-primary" />
                                        <div>
                                            <div className="font-medium">选择 AI 人格</div>
                                            <div className="text-sm text-muted-foreground">设置 AI 的性格和回复风格</div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border-primary/20">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <MessageSquare className="h-5 w-5 text-primary" />
                                        <div>
                                            <div className="font-medium">配置触发方式</div>
                                            <div className="text-sm text-muted-foreground">设置如何触发 AI 回复</div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <Alert className="mt-4">
                                <Info className="h-4 w-4" />
                                <AlertDescription>
                                    您可以随时跳过此向导，稍后在设置页面进行配置。
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* Step 1: Channel Configuration */}
                    {currentStep === 1 && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>快速选择预设</Label>
                                <p className="text-sm text-muted-foreground">选择一个预设快速配置，或手动填写</p>
                            </div>

                            <Tabs defaultValue="free" className="w-full">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="free">免费渠道</TabsTrigger>
                                    <TabsTrigger value="paid">付费渠道</TabsTrigger>
                                </TabsList>
                                <TabsContent value="free" className="space-y-2 mt-2">
                                    {['free-glm', 'free-xiaomi', 'free-api', 'free-zhipu'].map(id => (
                                        <Card
                                            key={id}
                                            className={`cursor-pointer transition-all ${selectedChannelPreset === id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50'}`}
                                            onClick={() => handleChannelPresetSelect(id)}
                                        >
                                            <CardContent className="p-3 flex items-center justify-between">
                                                <div>
                                                    <div className="font-medium flex items-center gap-2">
                                                        {QUICK_PRESETS[id].name}
                                                        <Badge variant="secondary" className="text-xs">免费</Badge>
                                                    </div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {QUICK_PRESETS[id].description}
                                                    </div>
                                                </div>
                                                {selectedChannelPreset === id && (
                                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))}
                                </TabsContent>
                                <TabsContent value="paid" className="space-y-2 mt-2">
                                    {['openai', 'deepseek', 'siliconflow'].map(id => (
                                        <Card
                                            key={id}
                                            className={`cursor-pointer transition-all ${selectedChannelPreset === id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50'}`}
                                            onClick={() => handleChannelPresetSelect(id)}
                                        >
                                            <CardContent className="p-3 flex items-center justify-between">
                                                <div>
                                                    <div className="font-medium">{QUICK_PRESETS[id].name}</div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {QUICK_PRESETS[id].description}
                                                    </div>
                                                </div>
                                                {selectedChannelPreset === id && (
                                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))}
                                </TabsContent>
                            </Tabs>

                            {selectedChannelPreset && !QUICK_PRESETS[selectedChannelPreset].apiKey && (
                                <div className="space-y-3 pt-4 border-t">
                                    <Label htmlFor="apiKey">API Key *</Label>
                                    <Input
                                        id="apiKey"
                                        type="password"
                                        placeholder="请输入您的 API Key"
                                        value={channelForm.apiKey}
                                        onChange={e => setChannelForm({ ...channelForm, apiKey: e.target.value })}
                                    />
                                    {QUICK_PRESETS[selectedChannelPreset].authUrl && (
                                        <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                                            <a href={QUICK_PRESETS[selectedChannelPreset].authUrl} target="_blank" rel="noopener">
                                                获取 API Key <ExternalLink className="h-3 w-3 ml-1" />
                                            </a>
                                        </Button>
                                    )}
                                </div>
                            )}

                            {/* 连接测试状态 */}
                            {selectedChannelPreset && (
                                <div className="space-y-3 pt-4 border-t">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleTestConnection}
                                            disabled={testingConnection || !channelForm.baseUrl}
                                        >
                                            {testingConnection ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                    测试中...
                                                </>
                                            ) : (
                                                '测试连接'
                                            )}
                                        </Button>
                                        {connectionStatus === 'success' && (
                                            <span className="flex items-center gap-1 text-sm text-green-600">
                                                <CheckCircle2 className="h-4 w-4" />
                                                连接成功
                                            </span>
                                        )}
                                        {connectionStatus === 'error' && (
                                            <span className="text-sm text-red-600">
                                                连接失败: {connectionError}
                                            </span>
                                        )}
                                    </div>
                                    {connectionStatus === 'idle' && channelForm.baseUrl && (
                                        <p className="text-xs text-muted-foreground">
                                            建议在继续前测试连接，确保 API 配置正确
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: Model Selection */}
                    {currentStep === 2 && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>选择默认模型</Label>
                                <p className="text-sm text-muted-foreground">
                                    选择一个模型作为默认对话模型
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <Select value={defaultModel} onValueChange={setDefaultModel}>
                                    <SelectTrigger className="flex-1">
                                        <SelectValue placeholder="选择模型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableModels.map(model => (
                                            <SelectItem key={model} value={model}>
                                                {model}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    variant="outline"
                                    onClick={handleFetchModels}
                                    disabled={fetchingModels}
                                >
                                    {fetchingModels ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        '获取模型'
                                    )}
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <Label>或手动输入模型名称</Label>
                                <Input
                                    placeholder="例如: gpt-4o, deepseek-chat"
                                    value={defaultModel}
                                    onChange={e => setDefaultModel(e.target.value)}
                                />
                            </div>

                            {availableModels.length > 0 && (
                                <div className="space-y-2">
                                    <Label>可用模型</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {availableModels.slice(0, 10).map(model => (
                                            <Badge
                                                key={model}
                                                variant={model === defaultModel ? 'default' : 'outline'}
                                                className="cursor-pointer"
                                                onClick={() => setDefaultModel(model)}
                                            >
                                                {model}
                                            </Badge>
                                        ))}
                                        {availableModels.length > 10 && (
                                            <Badge variant="secondary">+{availableModels.length - 10} 更多</Badge>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 3: Preset Selection */}
                    {currentStep === 3 && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>选择 AI 人格</Label>
                                <p className="text-sm text-muted-foreground">
                                    为您的 AI 选择一个人格预设，决定它的回复风格
                                </p>
                            </div>

                            <div className="space-y-3">
                                {BUILTIN_PRESETS.map(preset => {
                                    const Icon = preset.icon
                                    const isSelected = selectedPresetType === 'builtin' && selectedBuiltinPreset === preset.id
                                    const colorMap: Record<string, string> = {
                                        blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                                        pink: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
                                        purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                    }
                                    return (
                                        <Card
                                            key={preset.id}
                                            className={cn(
                                                'cursor-pointer transition-all',
                                                isSelected ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50'
                                            )}
                                            onClick={() => {
                                                setSelectedPresetType('builtin')
                                                setSelectedBuiltinPreset(preset.id)
                                            }}
                                        >
                                            <CardContent className="p-4 flex items-center gap-4">
                                                <div className={cn('p-3 rounded-xl', colorMap[preset.color])}>
                                                    <Icon className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium">{preset.name}</div>
                                                    <div className="text-sm text-muted-foreground">{preset.description}</div>
                                                </div>
                                                {isSelected && (
                                                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                                                )}
                                            </CardContent>
                                        </Card>
                                    )
                                })}
                            </div>

                            {/* 已有预设列表 */}
                            {existingPresets.length > 0 && (
                                <div className="space-y-2 pt-4 border-t">
                                    <Label className="text-sm">或选择已有预设</Label>
                                    <Select 
                                        value={selectedPresetType === 'existing' ? selectedExistingPreset : ''} 
                                        onValueChange={v => {
                                            setSelectedPresetType('existing')
                                            setSelectedExistingPreset(v)
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="选择已有预设" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {existingPresets.map(p => (
                                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* 自定义提示词 */}
                            {selectedPresetType === 'builtin' && selectedBuiltinPreset === 'custom' && (
                                <div className="space-y-2 pt-4 border-t">
                                    <Label>自定义系统提示词</Label>
                                    <Textarea
                                        value={customSystemPrompt}
                                        onChange={e => setCustomSystemPrompt(e.target.value)}
                                        placeholder="输入您希望 AI 遵循的人格设定..."
                                        rows={4}
                                        className="font-mono text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        提示：描述 AI 的性格特点、说话风格、知识背景等
                                    </p>
                                </div>
                            )}

                            {loadingPresets && (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 4: Trigger Settings */}
                    {currentStep === 4 && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>触发前缀</Label>
                                <p className="text-sm text-muted-foreground">
                                    设置触发 AI 回复的消息前缀
                                </p>
                            </div>

                            <div className="space-y-2">
                                {triggerPrefixes.map((prefix, index) => (
                                    <div key={index} className="flex gap-2">
                                        <Input
                                            value={prefix}
                                            onChange={e => {
                                                const newPrefixes = [...triggerPrefixes]
                                                newPrefixes[index] = e.target.value
                                                setTriggerPrefixes(newPrefixes)
                                            }}
                                            placeholder="输入前缀"
                                        />
                                        {triggerPrefixes.length > 1 && (
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => {
                                                    setTriggerPrefixes(triggerPrefixes.filter((_, i) => i !== index))
                                                }}
                                            >
                                                ×
                                            </Button>
                                        )}
                                    </div>
                                ))}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setTriggerPrefixes([...triggerPrefixes, ''])}
                                >
                                    添加前缀
                                </Button>
                            </div>

                            <Alert>
                                <Zap className="h-4 w-4" />
                                <AlertDescription>
                                    <strong>使用示例：</strong>发送 &quot;{triggerPrefixes[0] || '#chat'} 你好&quot; 即可触发 AI 回复。
                                    您也可以通过 @机器人 来触发回复。
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* Step 5: Complete */}
                    {currentStep === 5 && (
                        <div className="space-y-4 py-4">
                            <div className="text-center space-y-4">
                                <div className="w-16 h-16 mx-auto bg-green-500/10 rounded-full flex items-center justify-center">
                                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                                </div>
                                <h3 className="text-xl font-semibold">配置完成</h3>
                                <p className="text-muted-foreground">
                                    您已完成基础配置，现在可以开始使用了！
                                </p>
                            </div>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">配置摘要</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Plug className="h-4 w-4" /> 渠道
                                        </span>
                                        <Badge variant="outline">{channelForm.name || '未配置'}</Badge>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Bot className="h-4 w-4" /> 默认模型
                                        </span>
                                        <Badge variant="outline">{defaultModel || '未设置'}</Badge>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <User className="h-4 w-4" /> AI人格
                                        </span>
                                        <Badge variant="outline">
                                            {selectedPresetType === 'existing' 
                                                ? existingPresets.find(p => p.id === selectedExistingPreset)?.name || '已选预设'
                                                : BUILTIN_PRESETS.find(p => p.id === selectedBuiltinPreset)?.name || '智能助手'}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4" /> 触发前缀
                                        </span>
                                        <Badge variant="outline">{triggerPrefixes.filter(Boolean).join(', ') || '未设置'}</Badge>
                                    </div>
                                </CardContent>
                            </Card>

                            <Alert>
                                <Info className="h-4 w-4" />
                                <AlertDescription>
                                    您可以随时在「渠道管理」和「系统设置」页面修改这些配置。
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}
                </ScrollArea>

                <div className="flex justify-between pt-4 border-t shrink-0">
                    <div>
                        {currentStep === 0 && (
                            <Button variant="ghost" onClick={handleSkip}>
                                跳过向导
                            </Button>
                        )}
                        {currentStep > 0 && (
                            <Button variant="outline" onClick={handlePrev}>
                                <ChevronLeft className="h-4 w-4 mr-1" />
                                上一步
                            </Button>
                        )}
                    </div>
                    <div>
                        {currentStep < STEPS.length - 1 ? (
                            <Button onClick={handleNext}>
                                下一步
                                <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        ) : (
                            <Button onClick={handleComplete} disabled={saving}>
                                {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <Rocket className="h-4 w-4 mr-2" />
                                )}
                                开始使用
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default SetupWizard
