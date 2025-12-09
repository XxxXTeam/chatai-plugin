'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { channelsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, TestTube, Loader2, Plug, RefreshCw, Download, Eye, EyeOff, List, CheckCircle, XCircle, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ModelSelector } from '@/components/ModelSelector'

interface Channel {
  id: string
  name: string
  adapterType: string
  baseUrl: string
  apiKey: string
  models: string[]
  enabled: boolean
  status?: 'active' | 'error' | 'unknown'
  priority: number
  lastError?: string
  lastUsed?: number
  testedAt?: number
  stats?: {
    totalCalls?: number
    successCalls?: number
  }
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])

  const [form, setForm] = useState({
    name: '',
    adapterType: 'openai',
    baseUrl: '',
    apiKey: '',
    models: '',
    enabled: true,
    priority: 0,
    advanced: {
      streaming: { enabled: false, chunkSize: 1024 },
      thinking: { enableReasoning: false, defaultLevel: 'medium', adaptThinking: true, sendThinkingAsMessage: false },
      llm: { temperature: 0.7, maxTokens: 4000, topP: 1, frequencyPenalty: 0, presencePenalty: 0 }
    }
  })
  const [showAdvanced, setShowAdvanced] = useState(false)

  const fetchChannels = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await channelsApi.list(true)
      setChannels(res?.data || [])
    } catch (error) {
      toast.error('加载渠道失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChannels()
  }, [])

  const defaultAdvanced = {
    streaming: { enabled: false, chunkSize: 1024 },
    thinking: { enableReasoning: false, defaultLevel: 'medium', adaptThinking: true, sendThinkingAsMessage: false },
    llm: { temperature: 0.7, maxTokens: 4000, topP: 1, frequencyPenalty: 0, presencePenalty: 0 }
  }

  const resetForm = () => {
    setForm({
      name: '',
      adapterType: 'openai',
      baseUrl: '',
      apiKey: '',
      models: '',
      enabled: true,
      priority: 0,
      advanced: { ...defaultAdvanced }
    })
    setEditingChannel(null)
    setShowAdvanced(false)
  }

  const handleOpenDialog = (channel?: Channel) => {
    if (channel) {
      setEditingChannel(channel)
      setForm({
        name: channel.name,
        adapterType: channel.adapterType,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        models: channel.models?.join(', ') || '',
        enabled: channel.enabled,
        priority: channel.priority,
        advanced: (channel as any).advanced || { ...defaultAdvanced }
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.baseUrl || !form.apiKey) {
      toast.error('请填写必要信息')
      return
    }

    setSaving(true)
    try {
      const data = {
        ...form,
        models: form.models.split(',').map(m => m.trim()).filter(Boolean),
      }

      if (editingChannel) {
        await channelsApi.update(editingChannel.id, data)
        toast.success('渠道已更新')
      } else {
        await channelsApi.create(data)
        toast.success('渠道已创建')
      }

      setDialogOpen(false)
      resetForm()
      fetchChannels()
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此渠道？')) return
    try {
      await channelsApi.delete(id)
      toast.success('渠道已删除')
      fetchChannels()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const handleTest = async (channel: Channel) => {
    setTesting(channel.id)
    try {
      const res = await channelsApi.test({
        adapterType: channel.adapterType,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        models: channel.models,
      }) as any
      if (res?.data?.success || res?.success) {
        toast.success(res?.data?.message || res?.message || '连接成功')
      } else {
        toast.error(res?.data?.message || res?.message || '连接失败')
      }
      fetchChannels()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || '测试失败')
    } finally {
      setTesting(null)
    }
  }

  // 获取模型列表并打开选择器
  const handleFetchModels = async () => {
    if (!form.baseUrl || !form.apiKey) {
      toast.error('请先填写 Base URL 和 API Key')
      return
    }
    setFetchingModels(true)
    try {
      const res = await channelsApi.fetchModels({
        adapterType: form.adapterType,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
      }) as any
      const models = res?.data?.models || res?.models || []
      if (Array.isArray(models) && models.length > 0) {
        // 提取模型ID
        const modelIds = models.map((m: any) => typeof m === 'string' ? m : m.id || m.name).filter(Boolean)
        setAvailableModels(modelIds)
        // 设置当前已选模型
        const currentModels = form.models.split(',').map(m => m.trim()).filter(Boolean)
        setSelectedModels(currentModels.filter(m => modelIds.includes(m)))
        setModelSelectorOpen(true)
        toast.success(`获取到 ${modelIds.length} 个模型`)
      } else {
        toast.error('未获取到模型列表')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || '获取模型失败')
    } finally {
      setFetchingModels(false)
    }
  }

  // 确认模型选择
  const handleConfirmModels = () => {
    setForm({ ...form, models: selectedModels.join(', ') })
    setModelSelectorOpen(false)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">渠道管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchChannels}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加渠道
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingChannel ? '编辑渠道' : '添加渠道'}</DialogTitle>
                <DialogDescription>配置API渠道信息</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4 p-1">
                  <div className="grid gap-2">
                    <Label htmlFor="name">渠道名称</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="我的渠道"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="adapterType">适配器类型</Label>
                    <Select
                      value={form.adapterType}
                      onValueChange={(value) => setForm({ ...form, adapterType: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                        <SelectItem value="claude">Claude</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="baseUrl">Base URL</Label>
                    <Input
                      id="baseUrl"
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="apiKey">API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="apiKey"
                        type={showApiKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="models">模型列表</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                      >
                        {fetchingModels ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-3 w-3" />
                        )}
                        获取模型
                      </Button>
                    </div>
                    <Input
                      id="models"
                      value={form.models}
                      onChange={(e) => setForm({ ...form, models: e.target.value })}
                      placeholder="gpt-4o, gpt-4o-mini"
                    />
                    <p className="text-xs text-muted-foreground">多个模型用逗号分隔，或点击"获取模型"自动获取</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="priority">优先级</Label>
                    <Input
                      id="priority"
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>启用渠道</Label>
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                    />
                  </div>

                  {/* 高级设置 */}
                  <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between px-0">
                        <span className="flex items-center gap-2">
                          <Settings2 className="h-4 w-4" />
                          高级设置
                        </span>
                        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-4">
                      {/* 流式输出设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">流式输出</h4>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">启用流式输出</Label>
                          <Switch
                            checked={form.advanced.streaming.enabled}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              advanced: { ...form.advanced, streaming: { ...form.advanced.streaming, enabled: checked } }
                            })}
                          />
                        </div>
                      </div>

                      {/* 思考控制设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">思考控制</h4>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">启用推理模式</Label>
                          <Switch
                            checked={form.advanced.thinking.enableReasoning}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              advanced: { ...form.advanced, thinking: { ...form.advanced.thinking, enableReasoning: checked } }
                            })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-sm">默认思考级别</Label>
                          <Select
                            value={form.advanced.thinking.defaultLevel}
                            onValueChange={(value) => setForm({
                              ...form,
                              advanced: { ...form.advanced, thinking: { ...form.advanced.thinking, defaultLevel: value } }
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">低 (Low)</SelectItem>
                              <SelectItem value="medium">中 (Medium)</SelectItem>
                              <SelectItem value="high">高 (High)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">自适应思考</Label>
                          <Switch
                            checked={form.advanced.thinking.adaptThinking}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              advanced: { ...form.advanced, thinking: { ...form.advanced.thinking, adaptThinking: checked } }
                            })}
                          />
                        </div>
                      </div>

                      {/* LLM 参数设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">LLM 参数</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <Label>Temperature</Label>
                            <span className="text-muted-foreground">{form.advanced.llm.temperature}</span>
                          </div>
                          <Slider
                            value={[form.advanced.llm.temperature]}
                            min={0}
                            max={2}
                            step={0.1}
                            onValueChange={(v) => setForm({
                              ...form,
                              advanced: { ...form.advanced, llm: { ...form.advanced.llm, temperature: v[0] } }
                            })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-sm">Max Tokens</Label>
                          <Input
                            type="number"
                            value={form.advanced.llm.maxTokens}
                            onChange={(e) => setForm({
                              ...form,
                              advanced: { ...form.advanced, llm: { ...form.advanced.llm, maxTokens: parseInt(e.target.value) || 4000 } }
                            })}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <Label>Top P</Label>
                            <span className="text-muted-foreground">{form.advanced.llm.topP}</span>
                          </div>
                          <Slider
                            value={[form.advanced.llm.topP]}
                            min={0}
                            max={1}
                            step={0.1}
                            onValueChange={(v) => setForm({
                              ...form,
                              advanced: { ...form.advanced, llm: { ...form.advanced.llm, topP: v[0] } }
                            })}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Plug className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无渠道配置</p>
            <Button className="mt-4" onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              添加第一个渠道
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => {
            const adapterColors: Record<string, string> = {
              openai: 'bg-green-500',
              gemini: 'bg-blue-500', 
              claude: 'bg-orange-500',
            }
            const adapterType = channel.adapterType || 'openai'
            
            return (
              <Card key={channel.id} className="relative overflow-hidden hover:shadow-lg transition-shadow">
                {/* 顶部彩色条 */}
                <div className={`absolute top-0 left-0 right-0 h-1 ${adapterColors[adapterType] || 'bg-gray-500'}`} />
                
                <CardHeader className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-semibold">{channel.name}</CardTitle>
                    <div className="flex items-center gap-1.5">
                      {channel.enabled ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">启用</Badge>
                      ) : (
                        <Badge variant="secondary">禁用</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="outline" className="font-mono text-xs">
                      {adapterType.toUpperCase()}
                    </Badge>
                    {channel.status === 'active' ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        正常
                      </Badge>
                    ) : channel.status === 'error' ? (
                      <Badge variant="destructive" className="text-xs">
                        <XCircle className="h-3 w-3 mr-1" />
                        异常
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        未测试
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  {/* URL 显示 */}
                  <div className="p-2 bg-muted/50 rounded-md">
                    <p className="text-xs text-muted-foreground mb-1">Base URL</p>
                    <p className="text-sm font-mono truncate" title={channel.baseUrl}>
                      {channel.baseUrl}
                    </p>
                  </div>
                  
                  {/* 统计信息 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-2 bg-muted/30 rounded-md">
                      <p className="text-2xl font-bold text-primary">{channel.models?.length || 0}</p>
                      <p className="text-xs text-muted-foreground">模型数</p>
                    </div>
                    <div className="text-center p-2 bg-muted/30 rounded-md">
                      <p className="text-2xl font-bold">{channel.priority || 0}</p>
                      <p className="text-xs text-muted-foreground">优先级</p>
                    </div>
                  </div>
                  
                  {/* 操作按钮 */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleTest(channel)}
                      disabled={testing === channel.id}
                    >
                      {testing === channel.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <TestTube className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      测试
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpenDialog(channel)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(channel.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 模型选择对话框 */}
      <Dialog open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              选择模型
            </DialogTitle>
            <DialogDescription>
              从列表中选择需要使用的模型
            </DialogDescription>
          </DialogHeader>
          <ModelSelector
            value={selectedModels}
            allModels={availableModels}
            onChange={setSelectedModels}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setModelSelectorOpen(false)}>
              取消
            </Button>
            <Button onClick={handleConfirmModels}>
              确认选择 ({selectedModels.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
