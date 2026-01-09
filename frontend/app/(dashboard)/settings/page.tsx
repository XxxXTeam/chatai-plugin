'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select'
import { DynamicTags } from '@/components/ui/dynamic-tags'
// import { DynamicInput } from '@/components/ui/dynamic-input'
import { ModelSelector } from '@/components/ModelSelector'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { PageHeader, PageContainer } from '@/components/layout/PageHeader'
import { configApi, channelsApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  Save, Loader2, Info, X, RefreshCw, Settings2, Check,
  Settings, Zap, Bot, Wrench, Brain, Sparkles, MessageSquare, Shield
} from 'lucide-react'

interface PrefixPersona {
  prefix: string
  preset: string
}

interface Config {
  basic: {
    commandPrefix: string
    debug: boolean
    showThinkingMessage: boolean
    debugToConsoleOnly: boolean
    quoteReply: boolean
    autoRecall: {
      enabled: boolean
      delay: number
      recallError: boolean
    }
  }
  admin: {
    loginNotifyPrivate: boolean
    sensitiveCommandMasterOnly: boolean
  }
  llm: {
    defaultModel: string
    models: {
      chat: string
      tool: string
      dispatch: string
      image: string
      draw: string
      roleplay: string
      search: string
    }
    fallback: {
      enabled: boolean
      models: string[]
      maxRetries: number
      retryDelay: number
      notifyOnFallback: boolean
    }
  }
  context: {
    maxMessages: number
    autoEnd: {
      enabled: boolean
      maxRounds: number
    }
    groupContextSharing: boolean
    globalSystemPrompt: string
  }
  bym: {
    enable: boolean
    probability: number
    temperature: number
    maxTokens: number
    recall: boolean
    model: string
    presetId: string
    systemPrompt: string
    inheritPersonality: boolean
  }
  tools: {
    showCallLogs: boolean
    useForwardMsg: boolean
    parallelExecution: boolean
    sendIntermediateReply: boolean
    useToolGroups: boolean
    dispatchFirst: boolean
  }
  personality: {
    isolateContext: {
      enabled: boolean
      clearOnSwitch: boolean
    }
  }
  thinking: {
    enabled: boolean
    showThinkingContent: boolean
    useForwardMsg: boolean
  }
  features: {
    groupSummary: { enabled: boolean; maxMessages: number; model?: string }
    userPortrait: { enabled: boolean; minMessages: number; model?: string }
    poke: { enabled: boolean; pokeBack: boolean; message: string; prompt?: string }
    reaction: { enabled: boolean; prompt?: string; removePrompt?: string }
    recall: { enabled: boolean; aiResponse: boolean; prompt?: string }
    welcome: { enabled: boolean; message: string; prompt?: string }
    goodbye: { enabled: boolean; aiResponse: boolean; prompt?: string }
    ban: { enabled: boolean; aiResponse: boolean; prompt?: string }
    admin: { enabled: boolean; prompt?: string }
    luckyKing: { enabled: boolean; congratulate?: boolean; prompt?: string }
    honor: { enabled: boolean; prompt?: string }
    essence: { enabled: boolean; prompt?: string }
    imageGen: { 
      enabled: boolean
      apis: Array<{
        baseUrl: string
        apiKey: string
        models: string[]
      }>
      model: string
      videoModel: string
    }
    autoCleanOnError: { enabled: boolean; notifyUser: boolean }
  }
  memory: {
    enabled: boolean
    autoExtract: boolean
  }
  trigger: {
    private: { enabled: boolean; mode: string }
    group: { enabled: boolean; at: boolean; prefix: boolean; keyword: boolean; random: boolean; randomRate: number }
    prefixes: string[]
    prefixPersonas: PrefixPersona[]
    keywords: string[]
    collectGroupMsg: boolean
    blacklistUsers: string[]
    whitelistUsers: string[]
    blacklistGroups: string[]
    whitelistGroups: string[]
  }
}

// 默认配置
const defaultConfig: Config = {
  basic: {
    commandPrefix: '#ai',
    debug: false,
    showThinkingMessage: true,
    debugToConsoleOnly: true,
    quoteReply: true,
    autoRecall: { enabled: false, delay: 60, recallError: true }
  },
  admin: { loginNotifyPrivate: true, sensitiveCommandMasterOnly: true },
  llm: { 
    defaultModel: '', 
    models: { chat: '', tool: '', dispatch: '', image: '', draw: '', roleplay: '', search: '' },
    fallback: { enabled: false, models: [], maxRetries: 3, retryDelay: 500, notifyOnFallback: false }
  },
  context: { maxMessages: 20, autoEnd: { enabled: false, maxRounds: 50 }, groupContextSharing: true, globalSystemPrompt: '' },
  bym: { enable: false, probability: 0.02, temperature: 0.9, maxTokens: 100, recall: false, model: '', presetId: '', systemPrompt: '', inheritPersonality: true },
  tools: { showCallLogs: true, useForwardMsg: true, parallelExecution: true, sendIntermediateReply: true, useToolGroups: false, dispatchFirst: false },
  personality: { isolateContext: { enabled: false, clearOnSwitch: false } },
  thinking: { enabled: true, showThinkingContent: true, useForwardMsg: true },
  features: {
    groupSummary: { enabled: true, maxMessages: 100, model: '' },
    userPortrait: { enabled: true, minMessages: 10, model: '' },
    poke: { enabled: false, pokeBack: false, message: '别戳了~', prompt: '' },
    reaction: { enabled: false, prompt: '', removePrompt: '' },
    recall: { enabled: false, aiResponse: true, prompt: '' },
    welcome: { enabled: false, message: '', prompt: '' },
    goodbye: { enabled: false, aiResponse: false, prompt: '' },
    ban: { enabled: false, aiResponse: true, prompt: '' },
    admin: { enabled: false, prompt: '' },
    luckyKing: { enabled: false, congratulate: false, prompt: '' },
    honor: { enabled: false, prompt: '' },
    essence: { enabled: false, prompt: '' },
    imageGen: { 
      enabled: true, 
      apis: [],  // [{baseUrl, apiKey, models: []}]
      model: 'gemini-3-pro-image',
      videoModel: 'veo-2.0-generate-001'
    },
    autoCleanOnError: { enabled: false, notifyUser: true }
  },
  memory: { enabled: false, autoExtract: true },
  trigger: {
    private: { enabled: true, mode: 'always' },
    group: { enabled: true, at: true, prefix: true, keyword: false, random: false, randomRate: 0.05 },
    prefixes: ['#chat'],
    prefixPersonas: [],
    keywords: [],
    collectGroupMsg: true,
    blacklistUsers: [], whitelistUsers: [], blacklistGroups: [], whitelistGroups: []
  }
}

type ModelCategory = 'chat' | 'tool' | 'dispatch' | 'image' | 'draw' | 'roleplay' | 'search' | 'fallback' | 'default'

const MODEL_CATEGORY_LABELS: Record<ModelCategory, string> = {
  default: '默认模型',
  chat: '对话模型',
  tool: '工具模型',
  dispatch: '调度模型',
  image: '图像理解模型',
  draw: '绘图模型',
  roleplay: '伪人模型',
  search: '搜索模型',
  fallback: '备选模型'
}

const MODEL_CATEGORY_DESCRIPTIONS: Record<ModelCategory, string> = {
  default: '其他模型未配置时使用',
  chat: '普通对话，不传递工具',
  tool: '执行工具调用',
  dispatch: '选择工具组（轻量快速）',
  image: '分析理解图片内容',
  draw: '生成图片（如DALL-E）',
  roleplay: '伪人模式回复',
  search: '联网搜索',
  fallback: '主模型失败时使用'
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const defaultTab = searchParams.get('tab') || 'trigger'
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [allModels, setAllModels] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([])
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModelCategory, setEditingModelCategory] = useState<ModelCategory>('chat')
  const [tempSelectedModels, setTempSelectedModels] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const isInitialLoad = useRef(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // 当URL参数变化时更新tab
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab) setActiveTab(tab)
  }, [searchParams])
  const debouncedSave = useCallback(async (configToSave: Config) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await configApi.update(configToSave as unknown as Record<string, unknown>)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (error) {
        toast.error('自动保存失败')
        console.error(error)
        setSaveStatus('idle')
      }
    }, 800)
  }, [])

  // 监听配置变化自动保存
  useEffect(() => {
    if (isInitialLoad.current || !config) return
    debouncedSave(config)
  }, [config, debouncedSave])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [configRes, channelsRes, presetsRes] = await Promise.all([
          configApi.get(),
          channelsApi.list().catch(() => ({ data: [] })),
          presetsApi.list().catch(() => ({ data: [] }))
        ])
        
        // 深度合并配置
        const data = (configRes as { data?: Record<string, unknown> }).data || {}
        const merged = JSON.parse(JSON.stringify(defaultConfig))
        
        // 递归深度合并函数
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deepMerge = (target: Record<string, any>, source: Record<string, any>) => {
          Object.keys(source).forEach(key => {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
              if (!target[key]) target[key] = {}
              deepMerge(target[key], source[key])
            } else if (source[key] !== undefined) {
              target[key] = source[key]
            }
          })
        }
        deepMerge(merged, data)
        
        // 确保 llm 和 llm.models 对象存在
        if (!merged.llm) merged.llm = { defaultModel: '', models: {}, fallback: { enabled: false, models: [], maxRetries: 3, retryDelay: 500, notifyOnFallback: false } }
        if (!merged.llm.models) merged.llm.models = { chat: '', tool: '', dispatch: '', image: '', draw: '', roleplay: '', search: '' }
        if (!merged.llm.fallback) merged.llm.fallback = { enabled: false, models: [], maxRetries: 3, retryDelay: 500, notifyOnFallback: false }
        
        // 确保 prefixPersonas 是数组
        if (!Array.isArray(merged.trigger?.prefixPersonas)) {
          merged.trigger.prefixPersonas = []
        }
        
        // 确保 fallback.models 是数组
        if (merged.llm?.fallback && !Array.isArray(merged.llm.fallback.models)) {
          merged.llm.fallback.models = []
        }
        
        setConfig(merged)
        // 标记初始加载完成
        setTimeout(() => { isInitialLoad.current = false }, 100)

        // 获取所有模型
        const channels = (channelsRes as { data?: Array<{ models?: string[] }> })?.data || []
        const models = new Set<string>()
        channels.forEach((ch: { models?: string[] }) => {
          if (Array.isArray(ch.models)) {
            ch.models.forEach((m: string) => models.add(m))
          }
        })
        const modelList = Array.from(models).sort()
        setAllModels(modelList)
        setAvailableModels(modelList)
        
        // 设置预设列表
        const presetsData = (presetsRes as { data?: Array<{ id: string; name: string }> })?.data || []
        setPresets(presetsData)
      } catch (error) {
        toast.error('加载配置失败')
        console.error(error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // 获取可用模型列表
  const fetchAvailableModels = async () => {
    setFetchingModels(true)
    try {
      const res = await channelsApi.list()
      const channels = (res as { data?: Array<{ models?: string[] }> })?.data || []
      const models = new Set<string>()
      channels.forEach((ch: { models?: string[] }) => {
        if (Array.isArray(ch.models)) {
          ch.models.forEach((m: string) => models.add(m))
        }
      })
      const modelList = Array.from(models).sort()
      setAvailableModels(modelList)
      setAllModels(modelList)
      toast.success(`获取到 ${modelList.length} 个模型`)
    } catch (error) {
      toast.error('获取模型列表失败')
      console.error(error)
    } finally {
      setFetchingModels(false)
    }
  }

  // 打开模型选择对话框
  const openModelDialog = (category: ModelCategory) => {
    if (!config) return
    setEditingModelCategory(category)
    // 获取当前模型配置
    let currentModels: string[] = []
    if (category === 'default') {
      currentModels = config.llm?.defaultModel ? [config.llm.defaultModel] : []
    } else if (category === 'fallback') {
      currentModels = config.llm?.fallback?.models || []
    } else {
      // chat/roleplay/search 是单个字符串
      const model = config.llm?.models?.[category]
      currentModels = model ? [model] : []
    }
    setTempSelectedModels(currentModels)
    setModelDialogOpen(true)
  }
  const confirmModelSelection = () => {
    if (!config) return
    if (editingModelCategory === 'default') {
      updateConfig('llm.defaultModel', tempSelectedModels[0] || '')
    } else if (editingModelCategory === 'fallback') {
      updateConfig('llm.fallback.models', tempSelectedModels)
    } else {
      // chat/roleplay/search 只保存第一个选中的模型
      updateConfig(`llm.models.${editingModelCategory}`, tempSelectedModels[0] || '')
    }
    setModelDialogOpen(false)
  }
  
  // 判断是否是单选模式
  const isSingleSelectMode = () => {
    return editingModelCategory === 'default' || 
           editingModelCategory === 'chat' || 
           editingModelCategory === 'tool' ||
           editingModelCategory === 'dispatch' ||
           editingModelCategory === 'image' ||
           editingModelCategory === 'roleplay' || 
           editingModelCategory === 'search'
  }

  // 获取模型数量显示
  const getModelCount = (category: ModelCategory): number => {
    if (!config) return 0
    if (category === 'default') {
      return config.llm?.defaultModel ? 1 : 0
    }
    if (category === 'fallback') {
      return config.llm?.fallback?.models?.length || 0
    }
    return config.llm?.models?.[category] ? 1 : 0
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      await configApi.update(config as unknown as Record<string, unknown>)
      setSaveStatus('saved')
      toast.success('配置已保存')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const updateConfig = (path: string, value: unknown) => {
    if (!config) return
    const keys = path.split('.')
    // 深拷贝以确保 React 能检测到状态变化
    const newConfig = JSON.parse(JSON.stringify(config))
    let obj: Record<string, unknown> = newConfig
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>
    }
    obj[keys[keys.length - 1]] = value
    setConfig(newConfig as Config)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!config) {
    return <div>加载失败</div>
  }

  return (
    <PageContainer>
      <PageHeader
        title="系统设置"
        description="配置插件的核心功能和行为"
        icon={Settings}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline-flex items-center">
              {saveStatus === 'saving' && <><Loader2 className="h-4 w-4 animate-spin mr-1" />保存中</>}
              {saveStatus === 'saved' && <><Check className="h-4 w-4 text-green-500 mr-1" />已保存</>}
              {saveStatus === 'idle' && '自动保存'}
            </span>
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              保存
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1.5 bg-muted/50 p-1.5 rounded-xl mb-4">
          <TabsTrigger value="trigger" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Zap className="h-4 w-4 mr-1.5" />触发
          </TabsTrigger>
          <TabsTrigger value="basic" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Settings className="h-4 w-4 mr-1.5" />基础
          </TabsTrigger>
          <TabsTrigger value="admin" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Shield className="h-4 w-4 mr-1.5" />管理
          </TabsTrigger>
          <TabsTrigger value="llm" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Bot className="h-4 w-4 mr-1.5" />模型
          </TabsTrigger>
          <TabsTrigger value="bym" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <MessageSquare className="h-4 w-4 mr-1.5" />伪人
          </TabsTrigger>
          <TabsTrigger value="tools" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Wrench className="h-4 w-4 mr-1.5" />工具
          </TabsTrigger>
          <TabsTrigger value="thinking" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Brain className="h-4 w-4 mr-1.5" />思考
          </TabsTrigger>
          <TabsTrigger value="features" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-3 py-1.5 text-sm transition-all">
            <Sparkles className="h-4 w-4 mr-1.5" />高级
          </TabsTrigger>
        </TabsList>

        {/* AI触发配置 */}
        <TabsContent value="trigger" className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>配置机器人何时响应消息。私聊和群聊可独立配置触发方式。</AlertDescription>
          </Alert>
          
          <Card>
            <CardHeader>
              <CardTitle>私聊触发</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>响应私聊</Label>
                <Switch checked={config.trigger?.private?.enabled ?? true} onCheckedChange={(v) => updateConfig('trigger.private.enabled', v)} />
              </div>
              {config.trigger?.private?.enabled && (
                <div className="grid gap-2">
                  <Label>私聊模式</Label>
                  <Select value={config.trigger?.private?.mode || 'always'} onValueChange={(v) => updateConfig('trigger.private.mode', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">总是响应</SelectItem>
                      <SelectItem value="prefix">需要前缀</SelectItem>
                      <SelectItem value="off">关闭</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>群聊触发</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>响应群聊</Label>
                <Switch checked={config.trigger?.group?.enabled ?? true} onCheckedChange={(v) => updateConfig('trigger.group.enabled', v)} />
              </div>
              {config.trigger?.group?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <Label>@机器人触发</Label>
                    <Switch checked={config.trigger?.group?.at ?? true} onCheckedChange={(v) => updateConfig('trigger.group.at', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>前缀触发</Label>
                    <Switch checked={config.trigger?.group?.prefix ?? true} onCheckedChange={(v) => updateConfig('trigger.group.prefix', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>关键词触发</Label>
                    <Switch checked={config.trigger?.group?.keyword ?? false} onCheckedChange={(v) => updateConfig('trigger.group.keyword', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>随机触发</Label>
                      {config.trigger?.group?.random && (
                        <span className="ml-2 text-sm text-muted-foreground">{((config.trigger?.group?.randomRate || 0.05) * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    <Switch checked={config.trigger?.group?.random ?? false} onCheckedChange={(v) => updateConfig('trigger.group.random', v)} />
                  </div>
                  {config.trigger?.group?.random && (
                    <Slider value={[config.trigger?.group?.randomRate || 0.05]} min={0} max={0.5} step={0.01} onValueChange={(v) => updateConfig('trigger.group.randomRate', v[0])} />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>触发词</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>触发前缀</Label>
                <DynamicTags value={config.trigger?.prefixes || []} onChange={(v) => updateConfig('trigger.prefixes', v)} placeholder="输入前缀后按回车，如: #chat" />
              </div>
              {config.trigger?.group?.keyword && (
                <div className="space-y-2">
                  <Label>触发关键词</Label>
                  <DynamicTags value={config.trigger?.keywords || []} onChange={(v) => updateConfig('trigger.keywords', v)} placeholder="消息包含这些词时触发" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* 前缀人格 */}
          <Card>
            <CardHeader>
              <CardTitle>前缀人格</CardTitle>
              <CardDescription>为不同的触发前缀绑定不同的预设人格</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(config.trigger?.prefixPersonas || []).map((item, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    value={item.prefix}
                    onChange={(e) => {
                      const newList = [...(config.trigger?.prefixPersonas || [])]
                      newList[index] = { ...newList[index], prefix: e.target.value }
                      updateConfig('trigger.prefixPersonas', newList)
                    }}
                    placeholder="前缀，如: #猫娘"
                    className="flex-1"
                  />
                  <Input
                    value={item.preset}
                    onChange={(e) => {
                      const newList = [...(config.trigger?.prefixPersonas || [])]
                      newList[index] = { ...newList[index], preset: e.target.value }
                      updateConfig('trigger.prefixPersonas', newList)
                    }}
                    placeholder="预设名称"
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const newList = (config.trigger?.prefixPersonas || []).filter((_, i) => i !== index)
                      updateConfig('trigger.prefixPersonas', newList)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newList = [...(config.trigger?.prefixPersonas || []), { prefix: '', preset: '' }]
                  updateConfig('trigger.prefixPersonas', newList)
                }}
              >
                添加前缀人格
              </Button>
              <p className="text-xs text-muted-foreground">使用特定前缀触发时，会自动切换到对应的预设人格</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>访问控制</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>群白名单</Label>
                  <DynamicTags value={config.trigger?.whitelistGroups || []} onChange={(v) => updateConfig('trigger.whitelistGroups', v)} placeholder="群号" />
                </div>
                <div className="space-y-2">
                  <Label>群黑名单</Label>
                  <DynamicTags value={config.trigger?.blacklistGroups || []} onChange={(v) => updateConfig('trigger.blacklistGroups', v)} placeholder="群号" variant="destructive" />
                </div>
                <div className="space-y-2">
                  <Label>用户白名单</Label>
                  <DynamicTags value={config.trigger?.whitelistUsers || []} onChange={(v) => updateConfig('trigger.whitelistUsers', v)} placeholder="QQ号" />
                </div>
                <div className="space-y-2">
                  <Label>用户黑名单</Label>
                  <DynamicTags value={config.trigger?.blacklistUsers || []} onChange={(v) => updateConfig('trigger.blacklistUsers', v)} placeholder="QQ号" variant="destructive" />
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>采集群消息</Label>
                  <p className="text-sm text-muted-foreground">用于记忆和上下文分析</p>
                </div>
                <Switch checked={config.trigger?.collectGroupMsg ?? true} onCheckedChange={(v) => updateConfig('trigger.collectGroupMsg', v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 基础配置 */}
        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>基础配置</CardTitle>
              <CardDescription>插件基础功能设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>命令前缀</Label>
                <Input value={config.basic?.commandPrefix || '#ai'} onChange={(e) => updateConfig('basic.commandPrefix', e.target.value)} placeholder="#ai" />
                <p className="text-xs text-muted-foreground">管理命令的前缀，如 #ai帮助、#ai状态 等</p>
              </div>
              <div className="flex items-center justify-between">
                <div><Label>思考提示</Label><p className="text-sm text-muted-foreground">AI处理时发送&quot;思考中...&quot;提示</p></div>
                <Switch checked={config.basic?.showThinkingMessage ?? true} onCheckedChange={(v) => updateConfig('basic.showThinkingMessage', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>引用回复</Label><p className="text-sm text-muted-foreground">AI回复会引用触发消息</p></div>
                <Switch checked={config.basic?.quoteReply ?? true} onCheckedChange={(v) => updateConfig('basic.quoteReply', v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>调试模式</Label>
                <Switch checked={config.basic?.debug ?? false} onCheckedChange={(v) => updateConfig('basic.debug', v)} />
              </div>
              {config.basic?.debug && (
                <div className="flex items-center justify-between">
                  <Label>调试仅控制台</Label>
                  <Switch checked={config.basic?.debugToConsoleOnly ?? true} onCheckedChange={(v) => updateConfig('basic.debugToConsoleOnly', v)} />
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <div><Label>自动撤回</Label><p className="text-sm text-muted-foreground">自动撤回AI回复消息</p></div>
                <Switch checked={config.basic?.autoRecall?.enabled ?? false} onCheckedChange={(v) => updateConfig('basic.autoRecall.enabled', v)} />
              </div>
              {config.basic?.autoRecall?.enabled && (
                <>
                  <div className="grid gap-2">
                    <Label>撤回延迟（秒）</Label>
                    <Input type="number" value={config.basic?.autoRecall?.delay || 60} onChange={(e) => updateConfig('basic.autoRecall.delay', parseInt(e.target.value))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>撤回错误消息</Label>
                    <Switch checked={config.basic?.autoRecall?.recallError ?? true} onCheckedChange={(v) => updateConfig('basic.autoRecall.recallError', v)} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 管理配置 */}
        <TabsContent value="admin" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>管理配置</CardTitle>
              <CardDescription>管理员和权限设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  主人列表使用 Yunzai 框架配置，请编辑 <code className="bg-muted px-1 rounded">config/config/other.yaml</code> 中的 <code className="bg-muted px-1 rounded">masterQQ</code> 字段。
                  更多权限设置请前往 <a href="/permissions" className="text-primary underline">权限管理</a> 页面。
                </AlertDescription>
              </Alert>
              <div className="flex items-center justify-between">
                <div><Label>登录链接私聊推送</Label><p className="text-sm text-muted-foreground">群聊中触发管理面板命令时私聊推送登录链接</p></div>
                <Switch checked={config.admin?.loginNotifyPrivate ?? true} onCheckedChange={(v) => updateConfig('admin.loginNotifyPrivate', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>敏感命令仅主人</Label><p className="text-sm text-muted-foreground">敏感命令（如管理面板）仅限主人使用</p></div>
                <Switch checked={config.admin?.sensitiveCommandMasterOnly ?? true} onCheckedChange={(v) => updateConfig('admin.sensitiveCommandMasterOnly', v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="llm" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>模型配置</CardTitle>
              <CardDescription>模型选择和映射设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label>可用模型</Label>
                  <p className="text-sm text-muted-foreground">从已配置的渠道获取模型列表</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchAvailableModels} disabled={fetchingModels}>
                  {fetchingModels ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  获取模型 ({availableModels.length})
                </Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <Label>默认模型</Label>
                  <div className="flex items-center gap-2 mt-1">
                    {config.llm?.defaultModel ? (
                      <Badge variant="secondary">{config.llm.defaultModel}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">未配置</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">未配置分类模型时使用的默认模型</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => openModelDialog('default')} disabled={availableModels.length === 0}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  配置
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 模型分类配置 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">模型分类</CardTitle>
              <CardDescription>为不同场景配置专用模型（同一模型配置多个渠道时自动轮询）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(['chat', 'tool', 'dispatch', 'image', 'draw', 'roleplay', 'search'] as ModelCategory[]).map((category) => (
                <div key={category} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <Label>{MODEL_CATEGORY_LABELS[category]}</Label>
                    <p className="text-xs text-muted-foreground">{MODEL_CATEGORY_DESCRIPTIONS[category]}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {config.llm?.models?.[category] || '使用默认模型'}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openModelDialog(category)} disabled={availableModels.length === 0}>
                    <Settings2 className="mr-2 h-4 w-4" />
                    配置
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 备选模型 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">备选模型轮询</CardTitle>
              <CardDescription>当主模型失败时自动切换到备选模型</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用备选模型</Label><p className="text-sm text-muted-foreground">主模型调用失败时自动尝试备选模型</p></div>
                <Switch checked={config.llm?.fallback?.enabled ?? false} onCheckedChange={(v) => updateConfig('llm.fallback.enabled', v)} />
              </div>
              {config.llm?.fallback?.enabled && (
                <>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <Label>备选模型列表</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(config.llm?.fallback?.models || []).slice(0, 3).map((m) => (
                          <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                        ))}
                        {(config.llm?.fallback?.models?.length || 0) > 3 && (
                          <Badge variant="outline" className="text-xs">+{(config.llm?.fallback?.models?.length || 0) - 3}</Badge>
                        )}
                        {!config.llm?.fallback?.models?.length && (
                          <span className="text-xs text-muted-foreground">未配置备选模型</span>
                        )}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openModelDialog('fallback')} disabled={availableModels.length === 0}>
                      <Settings2 className="mr-2 h-4 w-4" />
                      配置 ({getModelCount('fallback')})
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>最大重试次数</Label>
                      <Input type="number" value={config.llm?.fallback?.maxRetries || 3} onChange={(e) => updateConfig('llm.fallback.maxRetries', parseInt(e.target.value))} min={1} max={10} />
                    </div>
                    <div className="grid gap-2">
                      <Label>重试延迟 (ms)</Label>
                      <Input type="number" value={config.llm?.fallback?.retryDelay || 500} onChange={(e) => updateConfig('llm.fallback.retryDelay', parseInt(e.target.value))} min={0} step={100} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><Label>切换通知</Label><p className="text-sm text-muted-foreground">切换到备选模型时通知用户</p></div>
                    <Switch checked={config.llm?.fallback?.notifyOnFallback ?? false} onCheckedChange={(v) => updateConfig('llm.fallback.notifyOnFallback', v)} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 伪人模式 */}
        <TabsContent value="bym" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>伪人模式</CardTitle>
              <CardDescription>随机模拟真人回复，使机器人更像真人</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用伪人模式</Label><p className="text-sm text-muted-foreground">AI回复更像真人</p></div>
                <Switch checked={config.bym?.enable ?? false} onCheckedChange={(v) => updateConfig('bym.enable', v)} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label>触发概率</Label><span className="text-sm text-muted-foreground">{((config.bym?.probability ?? 0.02) * 100).toFixed(0)}%</span></div>
                <Slider value={[config.bym?.probability ?? 0.02]} min={0.01} max={1} step={0.01} onValueChange={(v) => updateConfig('bym.probability', v[0])} />
                <p className="text-xs text-muted-foreground">全局默认概率，群组可继承此值</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label>回复温度</Label><span className="text-sm text-muted-foreground">{config.bym?.temperature || 0.9}</span></div>
                <Slider value={[config.bym?.temperature || 0.9]} min={0} max={2} step={0.1} onValueChange={(v) => updateConfig('bym.temperature', v[0])} />
              </div>
              <div className="grid gap-2">
                <Label>最大Token</Label>
                <Input type="number" value={config.bym?.maxTokens || 100} onChange={(e) => updateConfig('bym.maxTokens', parseInt(e.target.value))} />
              </div>
              <div className="flex items-center justify-between">
                <Label>启用记忆</Label>
                <Switch checked={config.bym?.recall ?? false} onCheckedChange={(v) => updateConfig('bym.recall', v)} />
              </div>
              <div className="grid gap-2">
                <Label>使用模型</Label>
                <Select value={config.bym?.model || '__default__'} onValueChange={(v) => updateConfig('bym.model', v === '__default__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="使用默认模型" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px] overflow-y-auto">
                    <SelectItem value="__default__">使用默认模型</SelectItem>
                    {allModels.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>伪人预设</Label>
                <Select value={config.bym?.presetId || '__default__'} onValueChange={(v) => updateConfig('bym.presetId', v === '__default__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择预设..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px] overflow-y-auto">
                    <SelectItem value="__default__">使用默认人设</SelectItem>
                    {presets.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">选择预设后将覆盖下方的系统提示词</p>
              </div>
              <div className="grid gap-2">
                <Label>系统提示词</Label>
                <Textarea value={config.bym?.systemPrompt || ''} onChange={(e) => updateConfig('bym.systemPrompt', e.target.value)} placeholder="伪人模式的系统提示词（选择预设后此项无效）" rows={3} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 工具调用 */}
        <TabsContent value="tools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>工具调用配置</CardTitle>
              <CardDescription>配置AI工具调用的行为</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>显示调用日志</Label><p className="text-sm text-muted-foreground">显示工具调用的详细日志</p></div>
                <Switch checked={config.tools?.showCallLogs ?? true} onCheckedChange={(v) => updateConfig('tools.showCallLogs', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>日志合并转发</Label><p className="text-sm text-muted-foreground">工具调用日志使用合并转发发送</p></div>
                <Switch checked={config.tools?.useForwardMsg ?? true} onCheckedChange={(v) => updateConfig('tools.useForwardMsg', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>并行执行</Label><p className="text-sm text-muted-foreground">多个无依赖的工具调用会并行执行</p></div>
                <Switch checked={config.tools?.parallelExecution ?? true} onCheckedChange={(v) => updateConfig('tools.parallelExecution', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>发送中间回复</Label><p className="text-sm text-muted-foreground">工具调用前先发送模型的文本回复</p></div>
                <Switch checked={config.tools?.sendIntermediateReply ?? true} onCheckedChange={(v) => updateConfig('tools.sendIntermediateReply', v)} />
              </div>
            </CardContent>
          </Card>

          {/* 工具组调度 */}
          <Card>
            <CardHeader>
              <CardTitle>工具组调度</CardTitle>
              <CardDescription>使用调度模型选择工具组，减少上下文消耗</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>启用工具组模式</Label>
                  <p className="text-sm text-muted-foreground">将工具按功能分组，调度时只传组摘要</p>
                </div>
                <Switch checked={config.tools?.useToolGroups ?? false} onCheckedChange={(v) => updateConfig('tools.useToolGroups', v)} />
              </div>
              {config.tools?.useToolGroups && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label>调度优先</Label>
                    <p className="text-sm text-muted-foreground">先用调度模型选择工具组，再用工具模型执行</p>
                  </div>
                  <Switch checked={config.tools?.dispatchFirst ?? false} onCheckedChange={(v) => updateConfig('tools.dispatchFirst', v)} />
                </div>
              )}
              {config.tools?.useToolGroups && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    工具组配置请在「MCP工具」页面管理。调度模型和工具模型请在上方「模型」标签页配置。
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>人格上下文</CardTitle>
              <CardDescription>配置独立人格的上下文隔离行为</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>独立上下文</Label><p className="text-sm text-muted-foreground">不同人格的对话历史相互独立</p></div>
                <Switch checked={config.personality?.isolateContext?.enabled ?? false} onCheckedChange={(v) => updateConfig('personality.isolateContext.enabled', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>切换时清除</Label><p className="text-sm text-muted-foreground">切换人格时清除原人格的上下文</p></div>
                <Switch checked={config.personality?.isolateContext?.clearOnSwitch ?? false} onCheckedChange={(v) => updateConfig('personality.isolateContext.clearOnSwitch', v)} disabled={!config.personality?.isolateContext?.enabled} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 深度思考 */}
        <TabsContent value="thinking" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>深度思考</CardTitle>
              <CardDescription>配置AI思考过程的显示和适配</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>启用思考适配</Label>
                  <p className="text-sm text-muted-foreground">开启后会解析和处理模型的思考内容 (如 reasoning_content 或 &lt;think&gt; 标签)</p>
                </div>
                <Switch checked={config.thinking?.enabled ?? true} onCheckedChange={(v) => updateConfig('thinking.enabled', v)} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>显示思考内容</Label>
                  <p className="text-sm text-muted-foreground">
                    {config.thinking?.enabled ? '显示AI的思考过程' : '需先启用思考适配'}
                  </p>
                </div>
                <Switch 
                  checked={config.thinking?.showThinkingContent ?? true} 
                  onCheckedChange={(v) => updateConfig('thinking.showThinkingContent', v)} 
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>思考合并转发</Label>
                  <p className="text-sm text-muted-foreground">
                    {config.thinking?.enabled ? '思考内容使用合并转发发送' : '需先启用思考适配'}
                  </p>
                </div>
                <Switch 
                  checked={config.thinking?.useForwardMsg ?? true} 
                  onCheckedChange={(v) => updateConfig('thinking.useForwardMsg', v)} 
                />
              </div>
              {!config.thinking?.enabled && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    思考适配已关闭，上方的显示和转发设置将不会生效。如需显示思考内容，请先开启&quot;启用思考适配&quot;。
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 高级功能 */}
        <TabsContent value="features" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>群聊总结</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch checked={config.features?.groupSummary?.enabled ?? true} onCheckedChange={(v) => updateConfig('features.groupSummary.enabled', v)} />
              </div>
              <div className="grid gap-2">
                <Label>最大消息数</Label>
                <Input type="number" value={config.features?.groupSummary?.maxMessages || 100} onChange={(e) => updateConfig('features.groupSummary.maxMessages', parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground">总结时分析的最大消息数量</p>
              </div>
              <div className="grid gap-2">
                <Label>总结模型</Label>
                <Select value={config.features?.groupSummary?.model || '__default__'} onValueChange={(v) => updateConfig('features.groupSummary.model', v === '__default__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="使用默认模型" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px] overflow-y-auto">
                    <SelectItem value="__default__">使用默认模型</SelectItem>
                    {allModels.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">指定用于群聊总结的模型</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>个人画像</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch checked={config.features?.userPortrait?.enabled ?? true} onCheckedChange={(v) => updateConfig('features.userPortrait.enabled', v)} />
              </div>
              <div className="grid gap-2">
                <Label>最少消息数</Label>
                <Input type="number" value={config.features?.userPortrait?.minMessages || 10} onChange={(e) => updateConfig('features.userPortrait.minMessages', parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground">生成画像需要的最少消息数量</p>
              </div>
              <div className="grid gap-2">
                <Label>画像模型</Label>
                <Select value={config.features?.userPortrait?.model || '__default__'} onValueChange={(v) => updateConfig('features.userPortrait.model', v === '__default__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="使用默认模型" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px] overflow-y-auto">
                    <SelectItem value="__default__">使用默认模型</SelectItem>
                    {allModels.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">指定用于生成用户画像的模型</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>戳一戳响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">被戳时使用AI人设回复</p></div>
                <Switch checked={config.features?.poke?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.poke.enabled', v)} />
              </div>
              {config.features?.poke?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <Label>自动回戳</Label>
                    <Switch checked={config.features?.poke?.pokeBack ?? false} onCheckedChange={(v) => updateConfig('features.poke.pokeBack', v)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>备用回复</Label>
                    <Input value={config.features?.poke?.message || ''} onChange={(e) => updateConfig('features.poke.message', e.target.value)} placeholder="AI回复失败时的备用回复" />
                  </div>
                  <div className="grid gap-2">
                    <Label>自定义提示词</Label>
                    <Textarea 
                      value={(config.features?.poke as { prompt?: string })?.prompt || ''} 
                      onChange={(e) => updateConfig('features.poke.prompt', e.target.value)} 
                      placeholder="[事件通知] {nickname} 戳了你一下。请根据你的人设性格，给出一个简短自然的回应。"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">支持占位符: {'{nickname}'} - 用户昵称</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>表情回应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">收到表情回应时使用AI人设处理</p></div>
                <Switch checked={config.features?.reaction?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.reaction.enabled', v)} />
              </div>
              {config.features?.reaction?.enabled && (
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label>添加回应提示词</Label>
                    <Textarea 
                      value={(config.features?.reaction as { prompt?: string })?.prompt || ''} 
                      onChange={(e) => updateConfig('features.reaction.prompt', e.target.value)} 
                      placeholder='[事件通知] {nickname} 对你之前的消息做出了"{emoji}"的表情回应。{context}这是对你消息的反馈，你可以简短回应表示感谢或互动，也可以选择不回复。'
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">留空使用默认模板</p>
                  </div>
                  <div className="grid gap-2">
                    <Label>取消回应提示词</Label>
                    <Textarea 
                      value={(config.features?.reaction as { removePrompt?: string })?.removePrompt || ''} 
                      onChange={(e) => updateConfig('features.reaction.removePrompt', e.target.value)} 
                      placeholder='[事件通知] {nickname} 取消了对你之前消息的"{emoji}"表情回应。{context}你可以忽略这个事件，也可以简短回应。'
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">留空使用默认模板</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    支持占位符: {'{nickname}'} 用户昵称, {'{emoji}'} 表情, {'{message}'} 原消息, {'{context}'} 上下文, {'{action}'} 动作类型, {'{action_text}'} 动作描述, {'{user_id}'} 用户ID, {'{group_id}'} 群号
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>消息撤回响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">群成员撤回消息时响应</p></div>
                <Switch checked={config.features?.recall?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.recall.enabled', v)} />
              </div>
              {config.features?.recall?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div><Label>AI响应</Label><p className="text-sm text-muted-foreground">使用AI人设调侃撤回</p></div>
                    <Switch checked={config.features?.recall?.aiResponse ?? true} onCheckedChange={(v) => updateConfig('features.recall.aiResponse', v)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>自定义提示词</Label>
                    <Textarea 
                      value={(config.features?.recall as { prompt?: string })?.prompt || ''} 
                      onChange={(e) => updateConfig('features.recall.prompt', e.target.value)} 
                      placeholder="[事件通知] {nickname} 刚刚撤回了一条消息{message_hint}。你可以调侃一下，也可以忽略。"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      支持占位符: {'{nickname}'}, {'{message}'} 撤回的消息内容, {'{message_hint}'} 智能消息提示, {'{time}'} 时间, {'{group_name}'}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>入群欢迎</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">新成员入群时发送欢迎消息</p></div>
                <Switch checked={config.features?.welcome?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.welcome.enabled', v)} />
              </div>
              {config.features?.welcome?.enabled && (
                <>
                  <div className="grid gap-2">
                    <Label>默认欢迎语</Label>
                    <Input value={config.features?.welcome?.message || ''} onChange={(e) => updateConfig('features.welcome.message', e.target.value)} placeholder="留空则使用AI生成" />
                    <p className="text-xs text-muted-foreground">留空时使用AI人设生成欢迎语</p>
                  </div>
                  <div className="grid gap-2">
                    <Label>自定义提示词</Label>
                    <Textarea 
                      value={(config.features?.welcome as { prompt?: string })?.prompt || ''} 
                      onChange={(e) => updateConfig('features.welcome.prompt', e.target.value)} 
                      placeholder="[事件通知] {nickname} 刚刚加入了群聊。请用你的人设性格给出一个简短友好的欢迎语。"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">支持占位符: {'{nickname}'} 用户昵称, {'{user_id}'} 用户ID, {'{group_name}'} 群名</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>退群通知</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">成员退群时发送通知</p></div>
                <Switch checked={config.features?.goodbye?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.goodbye.enabled', v)} />
              </div>
              {config.features?.goodbye?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div><Label>AI响应</Label><p className="text-sm text-muted-foreground">使用AI人设表达</p></div>
                    <Switch checked={config.features?.goodbye?.aiResponse ?? false} onCheckedChange={(v) => updateConfig('features.goodbye.aiResponse', v)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>自定义提示词</Label>
                    <Textarea 
                      value={(config.features?.goodbye as { prompt?: string })?.prompt || ''} 
                      onChange={(e) => updateConfig('features.goodbye.prompt', e.target.value)} 
                      placeholder="[事件通知] {nickname} {action}了群聊。你可以简短表达一下，也可以忽略。"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">支持占位符: {'{nickname}'}, {'{action}'} (退出/被踢出), {'{operator}'} 踢人者, {'{leave_reason}'} 智能原因, {'{group_name}'}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>禁言事件响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">群成员被禁言/解禁时响应</p></div>
                <Switch checked={(config.features as { ban?: { enabled?: boolean } })?.ban?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.ban.enabled', v)} />
              </div>
              {(config.features as { ban?: { enabled?: boolean } })?.ban?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div><Label>AI响应</Label><p className="text-sm text-muted-foreground">使用AI人设评论禁言事件</p></div>
                    <Switch checked={(config.features as { ban?: { aiResponse?: boolean } })?.ban?.aiResponse ?? true} onCheckedChange={(v) => updateConfig('features.ban.aiResponse', v)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>自定义提示词</Label>
                    <Textarea 
                      value={(config.features as { ban?: { prompt?: string } })?.ban?.prompt || ''} 
                      onChange={(e) => updateConfig('features.ban.prompt', e.target.value)} 
                      placeholder="[事件通知] {nickname} 被 {operator} {action}。你可以简短评论一下，也可以忽略。"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">支持占位符: {'{nickname}'} 被禁言者, {'{operator}'} 操作者, {'{action}'}, {'{duration_text}'}, {'{sub_type}'} (ban/lift_ban)</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>运气王响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">机器人成为运气王时庆祝</p></div>
                <Switch checked={config.features?.luckyKing?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.luckyKing.enabled', v)} />
              </div>
              {config.features?.luckyKing?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div><Label>祝贺他人</Label><p className="text-sm text-muted-foreground">其他人成为运气王时也祝贺</p></div>
                    <Switch checked={(config.features?.luckyKing as { congratulate?: boolean })?.congratulate ?? false} onCheckedChange={(v) => updateConfig('features.luckyKing.congratulate', v)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>自定义提示词</Label>
                    <Textarea 
                      value={(config.features?.luckyKing as { prompt?: string })?.prompt || ''} 
                      onChange={(e) => updateConfig('features.luckyKing.prompt', e.target.value)} 
                      placeholder="[事件通知] {nickname} 成为了红包运气王！{action}"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">支持占位符: {'{nickname}'}, {'{action}'} (机器人:请表达开心/他人:可以祝贺)</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>荣誉变更响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">机器人获得龙王、群聊之火等荣誉时响应</p></div>
                <Switch checked={config.features?.honor?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.honor.enabled', v)} />
              </div>
              {config.features?.honor?.enabled && (
                <div className="grid gap-2">
                  <Label>自定义提示词</Label>
                  <Textarea 
                    value={(config.features?.honor as { prompt?: string })?.prompt || ''} 
                    onChange={(e) => updateConfig('features.honor.prompt', e.target.value)} 
                    placeholder='[事件通知] 你获得了群荣誉"{honor}"！请简短表达一下。'
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">支持占位符: {'{honor}'} 荣誉名称(龙王/群聊之火等), {'{group_name}'}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>精华消息响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">机器人的消息被设为精华时响应</p></div>
                <Switch checked={config.features?.essence?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.essence.enabled', v)} />
              </div>
              {config.features?.essence?.enabled && (
                <div className="grid gap-2">
                  <Label>自定义提示词</Label>
                  <Textarea 
                    value={(config.features?.essence as { prompt?: string })?.prompt || ''} 
                    onChange={(e) => updateConfig('features.essence.prompt', e.target.value)} 
                    placeholder="[事件通知] {operator} 把你之前发的消息设置成了精华消息！请简短表达一下。"
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">支持占位符: {'{operator}'} 操作者昵称, {'{group_name}'}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>管理员变更响应</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">机器人成为/取消管理员时响应</p></div>
                <Switch checked={(config.features as { admin?: { enabled?: boolean } })?.admin?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.admin.enabled', v)} />
              </div>
              {(config.features as { admin?: { enabled?: boolean } })?.admin?.enabled && (
                <div className="grid gap-2">
                  <Label>自定义提示词</Label>
                  <Textarea 
                    value={(config.features as { admin?: { prompt?: string } })?.admin?.prompt || ''} 
                    onChange={(e) => updateConfig('features.admin.prompt', e.target.value)} 
                    placeholder="[事件通知] 你{action}！请简短表达一下。"
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">支持占位符: {'{action}'} (被设置成了群管理员/的管理员身份被取消了)</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>错误处理</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>错误时自动结清</Label><p className="text-sm text-muted-foreground">API返回错误时自动删除对话历史</p></div>
                <Switch checked={config.features?.autoCleanOnError?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.autoCleanOnError.enabled', v)} />
              </div>
              {config.features?.autoCleanOnError?.enabled && (
                <div className="flex items-center justify-between">
                  <Label>提示用户</Label>
                  <Switch checked={config.features?.autoCleanOnError?.notifyUser ?? true} onCheckedChange={(v) => updateConfig('features.autoCleanOnError.notifyUser', v)} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>长期记忆</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>启用记忆</Label><p className="text-sm text-muted-foreground">AI会记住用户透露的个人信息和偏好</p></div>
                <Switch checked={config.memory?.enabled ?? false} onCheckedChange={(v) => updateConfig('memory.enabled', v)} />
              </div>
              {config.memory?.enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div><Label>自动提取</Label><p className="text-sm text-muted-foreground">自动从对话中提取值得记忆的信息</p></div>
                    <Switch checked={config.memory?.autoExtract ?? true} onCheckedChange={(v) => updateConfig('memory.autoExtract', v)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>记忆提取模型</Label>
                    <Input 
                      value={(config.memory as { model?: string })?.model || ''} 
                      onChange={(e) => updateConfig('memory.model', e.target.value)} 
                      placeholder="留空使用默认模型"
                    />
                    <p className="text-xs text-muted-foreground">用于记忆提取和总结的模型，留空则使用全局默认模型</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>定时总结推送</CardTitle>
              <CardDescription>按设定间隔自动向群聊推送消息总结，跳过已关闭的群</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>全局启用</Label><p className="text-sm text-muted-foreground">启用定时群聊总结推送功能</p></div>
                <Switch checked={(config.memory as { summaryPush?: { enabled?: boolean } })?.summaryPush?.enabled ?? false} onCheckedChange={(v) => updateConfig('memory.summaryPush.enabled', v)} />
              </div>
              {(config.memory as { summaryPush?: { enabled?: boolean } })?.summaryPush?.enabled && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>间隔类型</Label>
                      <Select 
                        value={(config.memory as { summaryPush?: { intervalType?: string } })?.summaryPush?.intervalType || 'day'} 
                        onValueChange={(v) => updateConfig('memory.summaryPush.intervalType', v)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="day">按天</SelectItem>
                          <SelectItem value="hour">按小时</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>间隔值</Label>
                      <Input type="number" min={1} value={(config.memory as { summaryPush?: { defaultInterval?: number } })?.summaryPush?.defaultInterval || 1} onChange={(e) => updateConfig('memory.summaryPush.defaultInterval', parseInt(e.target.value) || 1)} />
                    </div>
                    {((config.memory as { summaryPush?: { intervalType?: string } })?.summaryPush?.intervalType || 'day') === 'day' && (
                      <div className="space-y-2">
                        <Label>推送时间</Label>
                        <Select 
                          value={String((config.memory as { summaryPush?: { defaultPushHour?: number } })?.summaryPush?.defaultPushHour ?? 22)} 
                          onValueChange={(v) => updateConfig('memory.summaryPush.defaultPushHour', parseInt(v))}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 24 }, (_, i) => (
                              <SelectItem key={i} value={String(i)}>{i.toString().padStart(2, '0')}:00</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>消息数量</Label>
                      <Input type="number" min={10} max={500} value={(config.memory as { summaryPush?: { maxMessages?: number } })?.summaryPush?.maxMessages || 300} onChange={(e) => updateConfig('memory.summaryPush.maxMessages', parseInt(e.target.value) || 100)} />
                    </div>
                    <div className="space-y-2">
                      <Label>检查间隔（分钟）</Label>
                      <Input type="number" min={1} value={(config.memory as { summaryPush?: { checkInterval?: number } })?.summaryPush?.checkInterval || 60} onChange={(e) => updateConfig('memory.summaryPush.checkInterval', parseInt(e.target.value) || 60)} />
                      <p className="text-xs text-muted-foreground">检查是否需要推送的间隔</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>总结模型</Label>
                    <Select 
                      value={(config.memory as { summaryPush?: { model?: string } })?.summaryPush?.model || '__default__'} 
                      onValueChange={(v) => updateConfig('memory.summaryPush.model', v === '__default__' ? '' : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="使用默认模型" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">使用默认总结模型</SelectItem>
                        {allModels.map((model) => (
                          <SelectItem key={model} value={model}>{model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">未配置则使用「群聊总结」模型或默认模型</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><Label>使用LLM生成总结</Label><p className="text-sm text-muted-foreground">调用AI模型生成智能总结</p></div>
                    <Switch checked={(config.memory as { summaryPush?: { useLLM?: boolean } })?.summaryPush?.useLLM ?? true} onCheckedChange={(v) => updateConfig('memory.summaryPush.useLLM', v)} />
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">群组独立配置请在「群组管理」中设置，已关闭推送的群将被跳过</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>表情包小偷</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div><Label>全局启用</Label><p className="text-sm text-muted-foreground">所有群默认开启表情包收集</p></div>
                <Switch checked={(config.features as { emojiThief?: { globalEnabled?: boolean } })?.emojiThief?.globalEnabled ?? false} onCheckedChange={(v) => updateConfig('features.emojiThief.globalEnabled', v)} />
              </div>
              <div className="flex items-center justify-between">
                <div><Label>群独立文件夹</Label><p className="text-sm text-muted-foreground">每个群的表情存储到独立文件夹</p></div>
                <Switch checked={(config.features as { emojiThief?: { separateFolder?: boolean } })?.emojiThief?.separateFolder ?? false} onCheckedChange={(v) => updateConfig('features.emojiThief.separateFolder', v)} />
              </div>
              <div className="grid gap-2">
                <Label>每群最大表情数</Label>
                <Input type="number" value={(config.features as { emojiThief?: { maxCount?: number } })?.emojiThief?.maxCount || 1000} onChange={(e) => updateConfig('features.emojiThief.maxCount', parseInt(e.target.value))} />
              </div>
              <div className="grid gap-2">
                <Label>收集概率 (0-1)</Label>
                <Input type="number" step="0.1" min={0} max={1} value={(config.features as { emojiThief?: { stealRate?: number } })?.emojiThief?.stealRate ?? 1.0} onChange={(e) => updateConfig('features.emojiThief.stealRate', parseFloat(e.target.value))} />
                <p className="text-xs text-muted-foreground">看到表情包时收集的概率</p>
              </div>
              <div className="grid gap-2">
                <Label>触发模式</Label>
                <Select value={(config.features as { emojiThief?: { triggerMode?: string } })?.emojiThief?.triggerMode || 'chat_random'} onValueChange={(v) => updateConfig('features.emojiThief.triggerMode', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">仅收集（不发送）</SelectItem>
                    <SelectItem value="random">随机触发</SelectItem>
                    <SelectItem value="bym_follow">伪人跟随</SelectItem>
                    <SelectItem value="bym_random">伪人随机</SelectItem>
                    <SelectItem value="chat_follow">对话跟随</SelectItem>
                    <SelectItem value="chat_random">对话随机</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>触发概率 (0-1)</Label>
                <Input type="number" step="0.05" min={0} max={1} value={(config.features as { emojiThief?: { triggerRate?: number } })?.emojiThief?.triggerRate ?? 0.1} onChange={(e) => updateConfig('features.emojiThief.triggerRate', parseFloat(e.target.value))} />
                <p className="text-xs text-muted-foreground">触发发送表情包的概率</p>
              </div>
              <p className="text-xs text-muted-foreground">群组独立配置请在「群组管理」中设置</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>触发黑白名单</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>用户黑名单</Label>
                <DynamicTags 
                  value={config.trigger?.blacklistUsers || []} 
                  onChange={(v) => updateConfig('trigger.blacklistUsers', v)} 
                  placeholder="输入QQ号后回车"
                />
                <p className="text-xs text-muted-foreground">这些用户的消息将被忽略</p>
              </div>
              <div className="grid gap-2">
                <Label>用户白名单</Label>
                <DynamicTags 
                  value={config.trigger?.whitelistUsers || []} 
                  onChange={(v) => updateConfig('trigger.whitelistUsers', v)} 
                  placeholder="输入QQ号后回车"
                />
                <p className="text-xs text-muted-foreground">留空表示不限制，有值时仅这些用户可触发</p>
              </div>
              <Separator />
              <div className="grid gap-2">
                <Label>群黑名单</Label>
                <DynamicTags 
                  value={config.trigger?.blacklistGroups || []} 
                  onChange={(v) => updateConfig('trigger.blacklistGroups', v)} 
                  placeholder="输入群号后回车"
                />
                <p className="text-xs text-muted-foreground">这些群的消息将被忽略</p>
              </div>
              <div className="grid gap-2">
                <Label>群白名单</Label>
                <DynamicTags 
                  value={config.trigger?.whitelistGroups || []} 
                  onChange={(v) => updateConfig('trigger.whitelistGroups', v)} 
                  placeholder="输入群号后回车"
                />
                <p className="text-xs text-muted-foreground">留空表示不限制，有值时仅这些群可触发</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 模型选择对话框 - 移动端优化 */}
      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] sm:max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              配置{MODEL_CATEGORY_LABELS[editingModelCategory]}
            </DialogTitle>
            <DialogDescription>
              {isSingleSelectMode() 
                ? '选择一个模型（多个渠道支持此模型时自动轮询）' 
                : '选择多个备选模型，按优先级排序'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden min-h-0">
            <ModelSelector
              value={tempSelectedModels}
              allModels={availableModels}
              onChange={setTempSelectedModels}
              singleSelect={isSingleSelectMode()}
            />
          </div>
          <DialogFooter className="flex-shrink-0 pt-4 border-t mt-2 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setModelDialogOpen(false)} className="flex-1 sm:flex-none">
              取消
            </Button>
            <Button onClick={confirmModelSelection} className="flex-1 sm:flex-none">
              确认选择 ({tempSelectedModels.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
