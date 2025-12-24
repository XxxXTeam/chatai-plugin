'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
import { Textarea } from '@/components/ui/textarea'
import { scopeApi, presetsApi, channelsApi, knowledgeApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Users, RefreshCw, Settings, FileText, Bot, ChevronDown, BookOpen, GitBranch, X } from 'lucide-react'
import { ModelSelector } from '@/components/ModelSelector'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface GroupScope {
  groupId: string
  groupName?: string
  presetId?: string
  systemPrompt?: string
  modelId?: string
  enabled: boolean
  triggerMode?: string
  knowledgeIds?: string[]
  inheritFrom?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any
  createdAt?: number
  updatedAt?: number
}

interface KnowledgeDoc {
  id: string
  name: string
}

interface Channel {
  id: string
  name: string
  models?: string[]
}

interface Preset {
  id: string
  name: string
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupScope[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>([])
  const [, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupScope | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<GroupScope | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [allModels, setAllModels] = useState<string[]>([])
  const [newInheritSource, setNewInheritSource] = useState('')

  const [form, setForm] = useState({
    groupId: '',
    groupName: '',
    presetId: '__default__',
    systemPrompt: '',
    modelId: '__default__',
    enabled: true,
    triggerMode: 'default',
    bymEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    bymPresetId: '__default__' as string,  // 伪人预设选择
    bymPrompt: '',  // 自定义伪人提示词
    imageGenEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    summaryEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    eventEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    customPrefix: '',
    knowledgeIds: [] as string[],
    inheritFrom: [] as string[],
  })

  const fetchData = async () => {
    try {
      const [groupsRes, presetsRes, channelsRes, knowledgeRes] = await Promise.all([
        scopeApi.getGroups(),
        presetsApi.list(),
        channelsApi.list(),
        knowledgeApi.list()
      ])
      setGroups(groupsRes?.data || [])
      setPresets(presetsRes?.data || [])
      setKnowledgeDocs((knowledgeRes?.data || []).map((k: { id: string; name: string }) => ({ id: k.id, name: k.name })))
      setChannels(channelsRes?.data || [])
      // 提取所有模型
      const models = new Set<string>()
      ;((channelsRes as { data?: Channel[] })?.data || []).forEach((ch: Channel) => {
        if (Array.isArray(ch.models)) {
          ch.models.forEach((m: string) => models.add(m))
        }
      })
      setAllModels(Array.from(models).sort())
    } catch (error) {
      toast.error('加载数据失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const resetForm = () => {
    setForm({
      groupId: '',
      groupName: '',
      presetId: '__default__',
      systemPrompt: '',
      modelId: '__default__',
      enabled: true,
      triggerMode: 'default',
      bymEnabled: 'inherit',
      bymPresetId: '__default__',
      bymPrompt: '',
      imageGenEnabled: 'inherit',
      summaryEnabled: 'inherit',
      eventEnabled: 'inherit',
      customPrefix: '',
      knowledgeIds: [],
      inheritFrom: [],
    })
    setEditingGroup(null)
    setNewInheritSource('')
  }

  const handleOpenDialog = (group?: GroupScope) => {
    if (group) {
      setEditingGroup(group)
      // 兼容 settings 嵌套结构 - 优先从 settings 中读取
      const settings = group.settings || {}
      // modelId 被存储在 settings JSON 字段中
      const savedModelId = settings.modelId || group.modelId || ''
      setForm({
        groupId: group.groupId,
        groupName: settings.groupName || group.groupName || '',
        presetId: group.presetId || settings.presetId || '__default__',
        systemPrompt: group.systemPrompt || settings.systemPrompt || '',
        modelId: savedModelId || '__default__',
        enabled: group.enabled ?? settings.enabled ?? true,
        triggerMode: settings.triggerMode || group.triggerMode || 'default',
        bymEnabled: settings.bymEnabled === undefined ? 'inherit' : settings.bymEnabled ? 'on' : 'off',
        bymPresetId: settings.bymPresetId || '__default__',
        bymPrompt: settings.bymPrompt || '',
        imageGenEnabled: settings.imageGenEnabled === undefined ? 'inherit' : settings.imageGenEnabled ? 'on' : 'off',
        summaryEnabled: settings.summaryEnabled === undefined ? 'inherit' : settings.summaryEnabled ? 'on' : 'off',
        eventEnabled: settings.eventEnabled === undefined ? 'inherit' : settings.eventEnabled ? 'on' : 'off',
        customPrefix: settings.customPrefix || '',
        knowledgeIds: group.knowledgeIds || [],
        inheritFrom: group.inheritFrom || [],
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
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
        presetId: form.presetId === '__default__' ? '' : form.presetId,
        systemPrompt: form.systemPrompt || null,
        modelId: form.modelId === '__default__' ? '' : form.modelId,
        enabled: form.enabled,
        triggerMode: form.triggerMode,
        bymEnabled: form.bymEnabled === 'inherit' ? undefined : form.bymEnabled === 'on',
        bymPresetId: form.bymPresetId === '__default__' ? undefined : form.bymPresetId,
        bymPrompt: form.bymPrompt || undefined,
        imageGenEnabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
        summaryEnabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
        eventEnabled: form.eventEnabled === 'inherit' ? undefined : form.eventEnabled === 'on',
        customPrefix: form.customPrefix || undefined,
        knowledgeIds: form.knowledgeIds.length > 0 ? form.knowledgeIds : undefined,
        inheritFrom: form.inheritFrom.length > 0 ? form.inheritFrom : undefined,
      })
      toast.success('群配置已保存')
      setDialogOpen(false)
      resetForm()
      fetchData()
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingGroup) return
    
    setDeleting(true)
    try {
      await scopeApi.deleteGroup(deletingGroup.groupId)
      toast.success('群配置已删除')
      setDeleteDialogOpen(false)
      setDeletingGroup(null)
      fetchData()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    } finally {
      setDeleting(false)
    }
  }

  const openDeleteDialog = (group: GroupScope) => {
    setDeletingGroup(group)
    setDeleteDialogOpen(true)
  }

  const filteredGroups = groups.filter(group => 
    group.groupId.includes(searchQuery) || 
    group.groupName?.includes(searchQuery)
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">群组管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加群
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>{editingGroup ? '编辑群配置' : '添加群'}</DialogTitle>
                <DialogDescription>配置群聊个性化设置和独立人设</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="groupId">群号</Label>
                  <Input
                    id="groupId"
                    value={form.groupId}
                    onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                    placeholder="123456789"
                    disabled={!!editingGroup}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="groupName">群名称</Label>
                  <Input
                    id="groupName"
                    value={form.groupName}
                    onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                    placeholder="可选"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="presetId">使用预设</Label>
                  <Select
                    value={form.presetId}
                    onValueChange={(value) => setForm({ ...form, presetId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="使用默认预设" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">使用默认预设</SelectItem>
                      {presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="modelId">
                    使用模型 <span className="text-xs text-muted-foreground">(设置后群聊将使用指定模型)</span>
                  </Label>
                  <Collapsible open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span className="truncate">
                          {form.modelId && form.modelId !== '__default__' ? form.modelId : '使用默认模型'}
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${modelSelectorOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="border rounded-lg p-3">
                        <div className="mb-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start text-muted-foreground"
                            onClick={() => {
                              setForm({ ...form, modelId: '__default__' })
                              setModelSelectorOpen(false)
                            }}
                          >
                            使用默认模型
                          </Button>
                        </div>
                        <ModelSelector
                          value={form.modelId && form.modelId !== '__default__' ? [form.modelId] : []}
                          allModels={allModels}
                          onChange={(models) => {
                            setForm({ ...form, modelId: models[0] || '__default__' })
                            if (models.length > 0) setModelSelectorOpen(false)
                          }}
                          singleSelect={true}
                          allowCustom={true}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="triggerMode">触发模式</Label>
                  <Select
                    value={form.triggerMode}
                    onValueChange={(value) => setForm({ ...form, triggerMode: value })}
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
                <div className="grid gap-2">
                  <Label htmlFor="systemPrompt">
                    独立人设 <span className="text-xs text-muted-foreground">(设置后对话将使用此人设)</span>
                  </Label>
                  <Textarea
                    id="systemPrompt"
                    value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="不填写则使用预设配置..."
                    rows={4}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>启用AI响应</Label>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                  />
                </div>
                
                {/* 群组功能开关 */}
                <div className="border-t pt-4 mt-4">
                  <Label className="text-base font-medium">群组功能开关</Label>
                  <p className="text-xs text-muted-foreground mb-3">群管理员也可通过命令控制这些功能</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm">🎭 伪人模式</span>
                        <p className="text-xs text-muted-foreground">随机回复消息，模拟真人聊天</p>
                      </div>
                      <Select
                        value={form.bymEnabled}
                        onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, bymEnabled: v })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">继承全局</SelectItem>
                          <SelectItem value="on">开启</SelectItem>
                          <SelectItem value="off">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* 伪人人设配置 - 仅在伪人模式开启时显示 */}
                    {form.bymEnabled !== 'off' && (
                      <div className="ml-4 pl-4 border-l-2 border-muted space-y-3">
                        <div className="grid gap-2">
                          <Label className="text-sm">伪人人设</Label>
                          <Select
                            value={form.bymPresetId}
                            onValueChange={(v) => setForm({ ...form, bymPresetId: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择人设..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">使用默认预设</SelectItem>
                              <SelectItem value="__custom__">自定义提示词</SelectItem>
                              {presets.map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  {preset.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            选择伪人模式使用的人设预设
                          </p>
                        </div>
                        
                        {/* 自定义伪人提示词 */}
                        {form.bymPresetId === '__custom__' && (
                          <div className="grid gap-2">
                            <Label className="text-sm">自定义伪人提示词</Label>
                            <Textarea
                              value={form.bymPrompt}
                              onChange={(e) => setForm({ ...form, bymPrompt: e.target.value })}
                              placeholder="你是一个真实的群友，说话简短自然，会使用网络用语..."
                              rows={4}
                              className="font-mono text-sm"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm">🎨 绘图功能</span>
                        <p className="text-xs text-muted-foreground">文生图、图生图、视频生成等</p>
                      </div>
                      <Select
                        value={form.imageGenEnabled}
                        onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, imageGenEnabled: v })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">继承全局</SelectItem>
                          <SelectItem value="on">开启</SelectItem>
                          <SelectItem value="off">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm">📊 群聊总结</span>
                        <p className="text-xs text-muted-foreground">允许使用群聊总结功能</p>
                      </div>
                      <Select
                        value={form.summaryEnabled}
                        onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, summaryEnabled: v })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">继承全局</SelectItem>
                          <SelectItem value="on">开启</SelectItem>
                          <SelectItem value="off">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm">📢 事件处理</span>
                        <p className="text-xs text-muted-foreground">入群欢迎、退群提醒等</p>
                      </div>
                      <Select
                        value={form.eventEnabled}
                        onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, eventEnabled: v })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">继承全局</SelectItem>
                          <SelectItem value="on">开启</SelectItem>
                          <SelectItem value="off">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                
                {/* 自定义前缀 */}
                <div className="grid gap-2">
                  <Label>自定义前缀 <span className="text-xs text-muted-foreground">(留空使用全局前缀)</span></Label>
                  <Input
                    value={form.customPrefix}
                    onChange={(e) => setForm({ ...form, customPrefix: e.target.value })}
                    placeholder="例如: #ai 或 /chat"
                  />
                </div>

                {/* 群组知识库配置 */}
                <div className="border-t pt-4 mt-4">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    群组知识库
                  </Label>
                  <p className="text-xs text-muted-foreground mb-3">为本群配置专属知识库，伪人模式将参考这些知识</p>
                  <div className="space-y-2">
                    {form.knowledgeIds.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {form.knowledgeIds.map((kId) => {
                          const doc = knowledgeDocs.find(d => d.id === kId)
                          return (
                            <Badge key={kId} variant="secondary" className="flex items-center gap-1">
                              <BookOpen className="h-3 w-3" />
                              {doc?.name || kId}
                              <button
                                type="button"
                                onClick={() => setForm({
                                  ...form,
                                  knowledgeIds: form.knowledgeIds.filter(id => id !== kId)
                                })}
                                className="ml-1 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">暂未配置知识库</p>
                    )}
                    <Select
                      value=""
                      onValueChange={(value) => {
                        if (value && !form.knowledgeIds.includes(value)) {
                          setForm({ ...form, knowledgeIds: [...form.knowledgeIds, value] })
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="添加知识库..." />
                      </SelectTrigger>
                      <SelectContent>
                        {knowledgeDocs
                          .filter(d => !form.knowledgeIds.includes(d.id))
                          .map((doc) => (
                            <SelectItem key={doc.id} value={doc.id}>
                              {doc.name}
                            </SelectItem>
                          ))}
                        {knowledgeDocs.filter(d => !form.knowledgeIds.includes(d.id)).length === 0 && (
                          <div className="text-sm text-muted-foreground py-2 px-2">
                            {knowledgeDocs.length === 0 ? '暂无可用知识库' : '已添加全部知识库'}
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 继承配置 */}
                <div className="border-t pt-4 mt-4">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    继承配置
                  </Label>
                  <p className="text-xs text-muted-foreground mb-3">
                    从其他来源继承提示词和知识库，支持：preset:预设ID、group:群号、knowledge:知识库ID
                  </p>
                  <div className="space-y-2">
                    {form.inheritFrom.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {form.inheritFrom.map((source) => {
                          const [type, id] = source.split(':')
                          let label = source
                          if (type === 'preset') {
                            const preset = presets.find(p => p.id === id)
                            label = `预设: ${preset?.name || id}`
                          } else if (type === 'group') {
                            const group = groups.find(g => g.groupId === id)
                            label = `群: ${group?.groupName || id}`
                          } else if (type === 'knowledge') {
                            const doc = knowledgeDocs.find(d => d.id === id)
                            label = `知识库: ${doc?.name || id}`
                          }
                          return (
                            <Badge key={source} variant="outline" className="flex items-center gap-1">
                              <GitBranch className="h-3 w-3" />
                              {label}
                              <button
                                type="button"
                                onClick={() => setForm({
                                  ...form,
                                  inheritFrom: form.inheritFrom.filter(s => s !== source)
                                })}
                                className="ml-1 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">暂未配置继承</p>
                    )}
                    <div className="flex gap-2">
                      <Input
                        value={newInheritSource}
                        onChange={(e) => setNewInheritSource(e.target.value)}
                        placeholder="preset:default 或 group:123456"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (newInheritSource && !form.inheritFrom.includes(newInheritSource)) {
                            setForm({ ...form, inheritFrom: [...form.inheritFrom, newInheritSource] })
                            setNewInheritSource('')
                          }
                        }}
                        disabled={!newInheritSource}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {/* 快捷添加 */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="text-xs text-muted-foreground mr-1">快捷添加:</span>
                      {presets.slice(0, 3).map(p => (
                        <Button
                          key={p.id}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => {
                            const source = `preset:${p.id}`
                            if (!form.inheritFrom.includes(source)) {
                              setForm({ ...form, inheritFrom: [...form.inheritFrom, source] })
                            }
                          }}
                          disabled={form.inheritFrom.includes(`preset:${p.id}`)}
                        >
                          {p.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
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

      {/* 搜索框 */}
      <div className="flex gap-4">
        <Input
          placeholder="搜索群号或群名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:max-w-sm"
        />
      </div>

      {filteredGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? '未找到匹配的群' : '暂无群配置'}
            </p>
            {!searchQuery && (
              <Button className="mt-4" onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加第一个群
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-320px)] sm:h-[calc(100vh-280px)]">
          <div className="space-y-3 pr-2 sm:pr-4">
            {filteredGroups.map((group) => (
              <Card key={group.groupId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{group.groupId}</span>
                        {group.groupName && (
                          <span className="text-muted-foreground">({group.groupName})</span>
                        )}
                        <Badge variant={(group.enabled ?? group.settings?.enabled) ? 'default' : 'secondary'}>
                          {(group.enabled ?? group.settings?.enabled) ? '已启用' : '已禁用'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {group.systemPrompt ? (
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            独立人设
                          </span>
                        ) : (
                          <span>预设: {presets.find(p => p.id === group.presetId)?.name || '默认'}</span>
                        )}
                        {(group.settings?.modelId || group.modelId) && (
                          <span className="flex items-center gap-1">
                            <Bot className="h-3 w-3" />
                            独立模型: {(group.settings?.modelId || group.modelId)?.substring(0, 20)}
                          </span>
                        )}
                        <span>模式: {group.triggerMode || '默认'}</span>
                        {group.knowledgeIds && group.knowledgeIds.length > 0 && (
                          <span className="flex items-center gap-1">
                            <BookOpen className="h-3 w-3" />
                            知识库: {group.knowledgeIds.length}个
                          </span>
                        )}
                        {group.inheritFrom && group.inheritFrom.length > 0 && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            继承: {group.inheritFrom.length}项
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenDialog(group)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openDeleteDialog(group)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除群 {deletingGroup?.groupId} 
              {deletingGroup?.groupName && ` (${deletingGroup.groupName})`} 的配置吗？
              此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
