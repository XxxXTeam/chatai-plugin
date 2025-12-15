'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
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
import { DynamicInput } from '@/components/ui/dynamic-input'
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
import { configApi, channelsApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  Save, Loader2, Info, X, RefreshCw, Settings2, Plus, Check,
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
    masterQQ: string[]
    loginNotifyPrivate: boolean
    sensitiveCommandMasterOnly: boolean
  }
  llm: {
    defaultModel: string
    models: {
      chat: string[]
      roleplay: string[]
      search: string[]
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
    systemPrompt: string
    inheritPersonality: boolean
  }
  tools: {
    showCallLogs: boolean
    useForwardMsg: boolean
    parallelExecution: boolean
    sendIntermediateReply: boolean
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
    groupSummary: { enabled: boolean; maxMessages: number }
    userPortrait: { enabled: boolean; minMessages: number }
    poke: { enabled: boolean; pokeBack: boolean; message: string }
    reaction: { enabled: boolean }
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
  admin: { masterQQ: [], loginNotifyPrivate: true, sensitiveCommandMasterOnly: true },
  llm: { 
    defaultModel: '', 
    models: { chat: [], roleplay: [], search: [] },
    fallback: { enabled: false, models: [], maxRetries: 3, retryDelay: 500, notifyOnFallback: false }
  },
  context: { maxMessages: 20, autoEnd: { enabled: false, maxRounds: 50 }, groupContextSharing: true, globalSystemPrompt: '' },
  bym: { enable: false, probability: 0.02, temperature: 0.9, maxTokens: 100, recall: false, model: '', systemPrompt: '', inheritPersonality: true },
  tools: { showCallLogs: true, useForwardMsg: true, parallelExecution: true, sendIntermediateReply: true },
  personality: { isolateContext: { enabled: false, clearOnSwitch: false } },
  thinking: { enabled: true, showThinkingContent: true, useForwardMsg: true },
  features: {
    groupSummary: { enabled: true, maxMessages: 100 },
    userPortrait: { enabled: true, minMessages: 10 },
    poke: { enabled: false, pokeBack: false, message: '别戳了~' },
    reaction: { enabled: false },
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

type ModelCategory = 'chat' | 'roleplay' | 'search' | 'fallback' | 'default'

const MODEL_CATEGORY_LABELS: Record<ModelCategory, string> = {
  default: '默认模型',
  chat: '对话模型',
  roleplay: '伪人模型',
  search: '搜索模型',
  fallback: '备选模型'
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [allModels, setAllModels] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  
  // 模型选择对话框状态
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModelCategory, setEditingModelCategory] = useState<ModelCategory>('chat')
  const [tempSelectedModels, setTempSelectedModels] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const isInitialLoad = useRef(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 防抖自动保存
  const debouncedSave = useCallback(async (configToSave: Config) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await configApi.update(configToSave)
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
        const [configRes, channelsRes] = await Promise.all([
          configApi.get(),
          channelsApi.list().catch(() => ({ data: [] }))
        ])
        
        // 深度合并配置
        const data = (configRes as any).data || {}
        const merged = JSON.parse(JSON.stringify(defaultConfig))
        
        // 递归深度合并函数
        const deepMerge = (target: any, source: any) => {
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
        if (!merged.llm.models) merged.llm.models = {}
        if (!merged.llm.fallback) merged.llm.fallback = { enabled: false, models: [], maxRetries: 3, retryDelay: 500, notifyOnFallback: false }
        
        // 确保模型配置是数组格式 (后端返回string，前端需要string[])
        const modelKeys = ['chat', 'roleplay', 'search']
        modelKeys.forEach(key => {
          const val = merged.llm.models[key]
          if (typeof val === 'string') {
            merged.llm.models[key] = val ? [val] : []
          } else if (!Array.isArray(val)) {
            merged.llm.models[key] = []
          }
        })
        
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
        const channels = (channelsRes as any)?.data || []
        const models = new Set<string>()
        channels.forEach((ch: any) => {
          if (Array.isArray(ch.models)) {
            ch.models.forEach((m: string) => models.add(m))
          }
        })
        const modelList = Array.from(models).sort()
        setAllModels(modelList)
        setAvailableModels(modelList)
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
      const channels = (res as any)?.data || []
      const models = new Set<string>()
      channels.forEach((ch: any) => {
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
      // 默认模型是单个值，转为数组
      currentModels = config.llm?.defaultModel ? [config.llm.defaultModel] : []
    } else if (category === 'fallback') {
      currentModels = config.llm?.fallback?.models || []
    } else {
      currentModels = config.llm?.models?.[category] || []
    }
    setTempSelectedModels(Array.isArray(currentModels) ? currentModels : [])
    setModelDialogOpen(true)
  }

  // 确认模型选择
  const confirmModelSelection = () => {
    if (!config) return
    if (editingModelCategory === 'default') {
      // 默认模型只取第一个
      updateConfig('llm.defaultModel', tempSelectedModels[0] || '')
    } else if (editingModelCategory === 'fallback') {
      updateConfig('llm.fallback.models', tempSelectedModels)
    } else {
      updateConfig(`llm.models.${editingModelCategory}`, tempSelectedModels)
    }
    setModelDialogOpen(false)
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
    return config.llm?.models?.[category]?.length || 0
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      await configApi.update(config)
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

      <Tabs defaultValue="trigger" className="w-full">
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
                <div><Label>思考提示</Label><p className="text-sm text-muted-foreground">AI处理时发送"思考中..."提示</p></div>
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
              <div className="space-y-2">
                <Label>主人QQ</Label>
                <DynamicTags value={config.admin?.masterQQ || []} onChange={(v) => updateConfig('admin.masterQQ', v)} placeholder="多个用回车分隔，留空使用Yunzai配置" />
              </div>
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
              <CardDescription>为不同场景配置专用模型</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(['chat', 'roleplay', 'search'] as ModelCategory[]).map((category) => (
                <div key={category} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <Label>{MODEL_CATEGORY_LABELS[category]}</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(config.llm?.models?.[category] || []).slice(0, 3).map((m) => (
                        <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                      ))}
                      {(config.llm?.models?.[category]?.length || 0) > 3 && (
                        <Badge variant="outline" className="text-xs">+{(config.llm?.models?.[category]?.length || 0) - 3}</Badge>
                      )}
                      {!config.llm?.models?.[category]?.length && (
                        <span className="text-xs text-muted-foreground">未配置，使用默认模型</span>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openModelDialog(category)} disabled={availableModels.length === 0}>
                    <Settings2 className="mr-2 h-4 w-4" />
                    配置 ({getModelCount(category)})
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
              {config.bym?.enable && (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between"><Label>触发概率</Label><span className="text-sm text-muted-foreground">{((config.bym?.probability ?? 0.02) * 100).toFixed(0)}%</span></div>
                    <Slider value={[config.bym?.probability ?? 0.02]} min={0.01} max={1} step={0.01} onValueChange={(v) => updateConfig('bym.probability', v[0])} />
                    <p className="text-xs text-muted-foreground">最小1%，如需完全禁用请关闭伪人模式开关</p>
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
                    <Input value={config.bym?.model || ''} onChange={(e) => updateConfig('bym.model', e.target.value)} placeholder="留空使用默认模型" />
                  </div>
                  <div className="grid gap-2">
                    <Label>系统提示词</Label>
                    <Textarea value={config.bym?.systemPrompt || ''} onChange={(e) => updateConfig('bym.systemPrompt', e.target.value)} placeholder="伪人模式的系统提示词" rows={3} />
                  </div>
                </>
              )}
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
                    思考适配已关闭，上方的显示和转发设置将不会生效。如需显示思考内容，请先开启"启用思考适配"。
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
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>表情回应</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div><Label>启用</Label><p className="text-sm text-muted-foreground">收到表情回应时使用AI人设处理</p></div>
                <Switch checked={config.features?.reaction?.enabled ?? false} onCheckedChange={(v) => updateConfig('features.reaction.enabled', v)} />
              </div>
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
                <div className="flex items-center justify-between">
                  <div><Label>自动提取</Label><p className="text-sm text-muted-foreground">自动从对话中提取值得记忆的信息</p></div>
                  <Switch checked={config.memory?.autoExtract ?? true} onCheckedChange={(v) => updateConfig('memory.autoExtract', v)} />
                </div>
              )}
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
              从列表中选择需要使用的模型
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden min-h-0">
            <ModelSelector
              value={tempSelectedModels}
              allModels={availableModels}
              onChange={setTempSelectedModels}
              singleSelect={editingModelCategory === 'default'}
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
