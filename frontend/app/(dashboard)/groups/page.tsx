'use client'

import { useEffect, useState, useMemo } from 'react'
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
  DialogFooter
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { scopeApi, presetsApi, channelsApi, knowledgeApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  Plus, Trash2, Loader2, Users, RefreshCw, Settings, FileText, Bot, 
  ChevronDown, BookOpen, GitBranch, X, Search, Power, PowerOff,
  Sparkles, Image, MessageSquare, PartyPopper, Palette, Zap, MoreHorizontal
} from 'lucide-react'
import { ModelSelector } from '@/components/ModelSelector'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

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

// 快速切换状态的辅助函数
const getStatusText = (enabled: boolean) => enabled ? '已启用' : '已禁用'

// 触发模式显示名称
const triggerModeNames: Record<string, string> = {
  'default': '默认',
  'at': '仅@触发',
  'prefix': '仅前缀',
  'all': '全部消息'
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [isMobile, setIsMobile] = useState(false)
  const [formTab, setFormTab] = useState('basic')
  const [togglingGroup, setTogglingGroup] = useState<string | null>(null)

  // 检测移动端
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const [form, setForm] = useState({
    groupId: '',
    groupName: '',
    presetId: '__default__',
    systemPrompt: '',
    modelId: '__default__',  // 默认模型（兼容旧配置）
    chatModel: '',  // 对话模型
    toolModel: '',  // 工具模型
    dispatchModel: '',  // 调度模型
    imageModel: '',  // 图像理解模型
    drawModel: '',  // 绘图模型
    searchModel: '',  // 搜索模型
    roleplayModel: '',  // 伪人模型
    enabled: true,
    triggerMode: 'default',
    bymEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    bymPresetId: '__default__' as string,  // 伪人预设选择
    bymPrompt: '',  // 自定义伪人提示词
    bymProbability: 'inherit' as 'inherit' | number,  // 伪人触发概率
    bymModel: '',  // 伪人使用模型
    bymTemperature: 'inherit' as 'inherit' | number,  // 伪人温度
    bymMaxTokens: 'inherit' as 'inherit' | number,  // 伪人最大Token
    emojiThiefEnabled: 'inherit' as 'inherit' | 'on' | 'off',  // 表情包小偷开关
    emojiThiefSeparateFolder: true,  // 独立文件夹
    emojiThiefMaxCount: 500,  // 最大表情包数量
    emojiThiefStealRate: 1.0,  // 偷取概率
    emojiThiefTriggerMode: 'random' as string,  // 发送模式
    emojiThiefTriggerRate: 0.05,  // 发送概率
    toolsEnabled: 'inherit' as 'inherit' | 'on' | 'off',  // 工具调用开关
    imageGenEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    imageGenModel: '',  // 绘图功能独立模型
    summaryEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    summaryModel: '',  // 总结功能独立模型
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
      chatModel: '',
      toolModel: '',
      dispatchModel: '',
      imageModel: '',
      drawModel: '',
      searchModel: '',
      roleplayModel: '',
      enabled: true,
      triggerMode: 'default',
      bymEnabled: 'inherit',
      bymPresetId: '__default__',
      bymPrompt: '',
      bymProbability: 'inherit' as 'inherit' | number,
      bymModel: '',
      bymTemperature: 'inherit' as 'inherit' | number,
      bymMaxTokens: 'inherit' as 'inherit' | number,
      emojiThiefEnabled: 'inherit' as 'inherit' | 'on' | 'off',
      emojiThiefSeparateFolder: true,
      emojiThiefMaxCount: 500,
      emojiThiefStealRate: 1.0,
      emojiThiefTriggerMode: 'random',
      emojiThiefTriggerRate: 0.05,
      toolsEnabled: 'inherit',
      imageGenEnabled: 'inherit',
      imageGenModel: '',
      summaryEnabled: 'inherit',
      summaryModel: '',
      eventEnabled: 'inherit',
      customPrefix: '',
      knowledgeIds: [],
      inheritFrom: [],
    })
    setEditingGroup(null)
  }

  const handleOpenDialog = (group?: GroupScope) => {
    if (group) {
      setEditingGroup(group)
      const settings = group.settings || {}
      // 兼容旧配置：如果没有chatModel，使用modelId
      const savedChatModel = settings.chatModel || settings.modelId || group.modelId || ''
      setForm({
        groupId: group.groupId,
        groupName: settings.groupName || group.groupName || '',
        presetId: group.presetId || settings.presetId || '__default__',
        systemPrompt: group.systemPrompt || settings.systemPrompt || '',
        modelId: '__default__', 
        chatModel: savedChatModel,
        toolModel: settings.toolModel || '',
        dispatchModel: settings.dispatchModel || '',
        imageModel: settings.imageModel || '',
        drawModel: settings.drawModel || '',
        searchModel: settings.searchModel || '',
        roleplayModel: settings.roleplayModel || '',
        enabled: group.enabled ?? settings.enabled ?? true,
        triggerMode: settings.triggerMode || group.triggerMode || 'default',
        bymEnabled: settings.bymEnabled === undefined ? 'inherit' : settings.bymEnabled ? 'on' : 'off',
        bymPresetId: settings.bymPresetId || '__default__',
        bymPrompt: settings.bymPrompt || '',
        bymProbability: settings.bymProbability === undefined ? 'inherit' : settings.bymProbability,
        bymModel: settings.bymModel || '',
        bymTemperature: settings.bymTemperature === undefined ? 'inherit' : settings.bymTemperature,
        bymMaxTokens: settings.bymMaxTokens === undefined ? 'inherit' : settings.bymMaxTokens,
        emojiThiefEnabled: settings.emojiThiefEnabled === undefined ? 'inherit' : settings.emojiThiefEnabled ? 'on' : 'off',
        emojiThiefSeparateFolder: settings.emojiThiefSeparateFolder ?? true,
        emojiThiefMaxCount: settings.emojiThiefMaxCount ?? 500,
        emojiThiefStealRate: settings.emojiThiefStealRate ?? 1.0,
        emojiThiefTriggerMode: settings.emojiThiefTriggerMode || 'random',
        emojiThiefTriggerRate: settings.emojiThiefTriggerRate ?? 0.05,
        toolsEnabled: settings.toolsEnabled === undefined ? 'inherit' : settings.toolsEnabled ? 'on' : 'off',
        imageGenEnabled: settings.imageGenEnabled === undefined ? 'inherit' : settings.imageGenEnabled ? 'on' : 'off',
        imageGenModel: settings.imageGenModel || '',
        summaryEnabled: settings.summaryEnabled === undefined ? 'inherit' : settings.summaryEnabled ? 'on' : 'off',
        summaryModel: settings.summaryModel || '',
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
        chatModel: form.chatModel || undefined,
        toolModel: form.toolModel || undefined,
        dispatchModel: form.dispatchModel || undefined,
        imageModel: form.imageModel || undefined,
        drawModel: form.drawModel || undefined,
        searchModel: form.searchModel || undefined,
        roleplayModel: form.roleplayModel || undefined,
        enabled: form.enabled,
        triggerMode: form.triggerMode,
        bymEnabled: form.bymEnabled === 'inherit' ? undefined : form.bymEnabled === 'on',
        bymPresetId: form.bymPresetId === '__default__' ? undefined : form.bymPresetId,
        bymPrompt: form.bymPrompt || undefined,
        bymProbability: form.bymProbability === 'inherit' ? undefined : form.bymProbability,
        bymModel: form.bymModel || undefined,
        bymTemperature: form.bymTemperature === 'inherit' ? undefined : form.bymTemperature,
        bymMaxTokens: form.bymMaxTokens === 'inherit' ? undefined : form.bymMaxTokens,
        emojiThiefEnabled: form.emojiThiefEnabled === 'inherit' ? undefined : form.emojiThiefEnabled === 'on',
        emojiThiefSeparateFolder: form.emojiThiefSeparateFolder,
        emojiThiefMaxCount: form.emojiThiefMaxCount,
        emojiThiefStealRate: form.emojiThiefStealRate,
        emojiThiefTriggerMode: form.emojiThiefTriggerMode,
        emojiThiefTriggerRate: form.emojiThiefTriggerRate,
        toolsEnabled: form.toolsEnabled === 'inherit' ? undefined : form.toolsEnabled === 'on',
        imageGenEnabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
        imageGenModel: form.imageGenModel || undefined,
        summaryEnabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
        summaryModel: form.summaryModel || undefined,
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

  // 快速切换群组启用状态
  const handleQuickToggle = async (group: GroupScope) => {
    const newEnabled = !(group.enabled ?? group.settings?.enabled ?? true)
    setTogglingGroup(group.groupId)
    try {
      await scopeApi.updateGroup(group.groupId, { enabled: newEnabled })
      toast.success(newEnabled ? '已启用群组' : '已禁用群组')
      fetchData()
    } catch (error) {
      toast.error('切换失败')
      console.error(error)
    } finally {
      setTogglingGroup(null)
    }
  }

  // 过滤群组
  const filteredGroups = useMemo(() => {
    return groups.filter(group => {
      const matchesSearch = group.groupId.includes(searchQuery) || 
        group.groupName?.toLowerCase().includes(searchQuery.toLowerCase())
      const isEnabled = group.enabled ?? group.settings?.enabled ?? true
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'enabled' && isEnabled) ||
        (statusFilter === 'disabled' && !isEnabled)
      return matchesSearch && matchesStatus
    })
  }, [groups, searchQuery, statusFilter])

  // 统计信息
  const stats = useMemo(() => ({
    total: groups.length,
    enabled: groups.filter(g => g.enabled ?? g.settings?.enabled ?? true).length,
    disabled: groups.filter(g => !(g.enabled ?? g.settings?.enabled ?? true)).length,
  }), [groups])

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

  // 表单内容渲染 - 用于 Dialog 和 Sheet
  const renderFormContent = () => (
    <Tabs value={formTab} onValueChange={setFormTab} className="w-full">
      <TabsList className="grid w-full grid-cols-4 mb-4">
        <TabsTrigger value="basic" className="text-xs sm:text-sm">
          <Settings className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
          基础
        </TabsTrigger>
        <TabsTrigger value="features" className="text-xs sm:text-sm">
          <Zap className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
          功能
        </TabsTrigger>
        <TabsTrigger value="bym" className="text-xs sm:text-sm">
          <Sparkles className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
          伪人
        </TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs sm:text-sm">
          <BookOpen className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
          高级
        </TabsTrigger>
      </TabsList>

      <TabsContent value="basic" className="space-y-4 mt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="groupId">群号 *</Label>
            <Input
              id="groupId"
              value={form.groupId}
              onChange={(e) => setForm({ ...form, groupId: e.target.value })}
              placeholder="123456789"
              disabled={!!editingGroup}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="groupName">群名称</Label>
            <Input
              id="groupName"
              value={form.groupName}
              onChange={(e) => setForm({ ...form, groupName: e.target.value })}
              placeholder="可选，便于识别"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>使用预设</Label>
            <Select value={form.presetId} onValueChange={(v) => setForm({ ...form, presetId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="使用默认预设" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">使用默认预设</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>触发模式</Label>
            <Select value={form.triggerMode} onValueChange={(v) => setForm({ ...form, triggerMode: v })}>
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
          <Label>独立人设</Label>
          <Textarea
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            placeholder="不填写则使用预设配置..."
            rows={3}
            className="font-mono text-sm resize-none"
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2">
            <Power className="h-4 w-4 text-muted-foreground" />
            <Label className="font-normal">启用AI响应</Label>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
        </div>
      </TabsContent>

      <TabsContent value="features" className="space-y-3 mt-0">
        <p className="text-xs text-muted-foreground mb-2">群管理员也可通过命令控制这些功能</p>
        
        {/* 工具调用 */}
        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-muted">
              <Zap className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">工具调用</p>
              <p className="text-xs text-muted-foreground">允许AI使用搜索、代码执行等工具</p>
            </div>
          </div>
          <Select
            value={form.toolsEnabled}
            onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, toolsEnabled: v })}
          >
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

        {/* 绘图功能 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-muted">
                <Image className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">绘图功能</p>
                <p className="text-xs text-muted-foreground">文生图、图生图等</p>
              </div>
            </div>
            <Select
              value={form.imageGenEnabled}
              onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, imageGenEnabled: v })}
            >
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
          {form.imageGenEnabled === 'on' && (
            <div className="ml-4 pl-4 border-l-2 border-muted space-y-2 animate-fade-in">
              <Label className="text-xs">绘图模型</Label>
              <Select value={form.imageGenModel || '__default__'} onValueChange={(v) => setForm({ ...form, imageGenModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="继承全局" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">继承全局</SelectItem>
                  {allModels.filter(m => m.includes('image') || m.includes('gemini') || m.includes('dalle') || m.includes('flux')).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* 群聊总结 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-muted">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">群聊总结</p>
                <p className="text-xs text-muted-foreground">允许使用群聊总结</p>
              </div>
            </div>
            <Select
              value={form.summaryEnabled}
              onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, summaryEnabled: v })}
            >
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
          {form.summaryEnabled === 'on' && (
            <div className="ml-4 pl-4 border-l-2 border-muted space-y-2 animate-fade-in">
              <Label className="text-xs">总结模型</Label>
              <Select value={form.summaryModel || '__default__'} onValueChange={(v) => setForm({ ...form, summaryModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="继承全局" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">继承全局</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* 事件处理 */}
        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-muted">
              <PartyPopper className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">事件处理</p>
              <p className="text-xs text-muted-foreground">入群欢迎、退群提醒</p>
            </div>
          </div>
          <Select
            value={form.eventEnabled}
            onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, eventEnabled: v })}
          >
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

        {/* 表情小偷 */}
        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-muted">
              <Palette className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">表情小偷</p>
              <p className="text-xs text-muted-foreground">收集并发送表情包</p>
            </div>
          </div>
          <Select
            value={form.emojiThiefEnabled}
            onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, emojiThiefEnabled: v })}
          >
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

        {form.emojiThiefEnabled !== 'off' && (
          <div className="ml-4 pl-4 border-l-2 border-muted space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <Label className="text-sm">独立存储</Label>
              <Switch
                checked={form.emojiThiefSeparateFolder}
                onCheckedChange={(v) => setForm({ ...form, emojiThiefSeparateFolder: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">最大数量</Label>
                <Input
                  type="number" min={10} max={5000}
                  value={form.emojiThiefMaxCount}
                  onChange={(e) => setForm({ ...form, emojiThiefMaxCount: parseInt(e.target.value) || 500 })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">偷取概率</Label>
                <Input
                  type="number" min={1} max={100}
                  value={Math.round(form.emojiThiefStealRate * 100)}
                  onChange={(e) => setForm({ ...form, emojiThiefStealRate: parseInt(e.target.value) / 100 })}
                />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Label>自定义前缀</Label>
          <Input
            value={form.customPrefix}
            onChange={(e) => setForm({ ...form, customPrefix: e.target.value })}
            placeholder="留空使用全局前缀，如 #ai"
          />
        </div>
      </TabsContent>

      <TabsContent value="bym" className="space-y-4 mt-0">
        <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-gradient-to-br from-purple-500/20 to-pink-500/20">
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-medium">伪人模式</p>
              <p className="text-xs text-muted-foreground">随机回复，模拟真人聊天</p>
            </div>
          </div>
          <Select
            value={form.bymEnabled}
            onValueChange={(v: 'inherit' | 'on' | 'off') => setForm({ ...form, bymEnabled: v })}
          >
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

        {form.bymEnabled !== 'off' && (
          <div className="space-y-4 animate-fade-in">
            <div className="space-y-2">
              <Label>伪人人设</Label>
              <Select value={form.bymPresetId} onValueChange={(v) => setForm({ ...form, bymPresetId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择人设..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">使用默认预设</SelectItem>
                  <SelectItem value="__custom__">自定义提示词</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.bymPresetId === '__custom__' && (
              <div className="space-y-2">
                <Label>自定义提示词</Label>
                <Textarea
                  value={form.bymPrompt}
                  onChange={(e) => setForm({ ...form, bymPrompt: e.target.value })}
                  placeholder="你是一个真实的群友..."
                  rows={3}
                  className="font-mono text-sm"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">触发概率</Label>
                <div className="flex items-center gap-2">
                  {form.bymProbability === 'inherit' ? (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({ ...form, bymProbability: 0.02 })}>
                      继承全局
                    </Button>
                  ) : (
                    <>
                      <Input
                        type="number" min={0} max={100}
                        value={typeof form.bymProbability === 'number' ? Math.round(form.bymProbability * 100) : 2}
                        onChange={(e) => setForm({ ...form, bymProbability: parseInt(e.target.value) / 100 })}
                        className="w-20"
                      />
                      <span className="text-sm">%</span>
                      <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, bymProbability: 'inherit' })}>
                        <X className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">使用模型</Label>
                <Select value={form.bymModel || '__default__'} onValueChange={(v) => setForm({ ...form, bymModel: v === '__default__' ? '' : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="继承" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">继承全局</SelectItem>
                    {allModels.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">温度</Label>
                {form.bymTemperature === 'inherit' ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({ ...form, bymTemperature: 0.9 })}>
                    继承全局
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={2} step={0.1}
                      value={typeof form.bymTemperature === 'number' ? form.bymTemperature : 0.9}
                      onChange={(e) => setForm({ ...form, bymTemperature: parseFloat(e.target.value) })}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, bymTemperature: 'inherit' })}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm">最大Token</Label>
                {form.bymMaxTokens === 'inherit' ? (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({ ...form, bymMaxTokens: 100 })}>
                    继承全局
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={10} max={2000}
                      value={typeof form.bymMaxTokens === 'number' ? form.bymMaxTokens : 100}
                      onChange={(e) => setForm({ ...form, bymMaxTokens: parseInt(e.target.value) })}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, bymMaxTokens: 'inherit' })}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="advanced" className="space-y-4 mt-0">
        {/* 模型分类配置 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <Label>模型配置</Label>
          </div>
          <p className="text-xs text-muted-foreground">为本群配置各场景独立模型（留空使用全局配置）</p>
          
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">对话模型 <span className="text-muted-foreground">（主模型）</span></Label>
              <Select value={form.chatModel || '__default__'} onValueChange={(v) => setForm({ ...form, chatModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">工具模型 <span className="text-muted-foreground">（需要调用工具时）</span></Label>
              <Select value={form.toolModel || '__default__'} onValueChange={(v) => setForm({ ...form, toolModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">调度模型 <span className="text-muted-foreground">（工具组分类）</span></Label>
              <Select value={form.dispatchModel || '__default__'} onValueChange={(v) => setForm({ ...form, dispatchModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">图像理解模型 <span className="text-muted-foreground">（分析图片）</span></Label>
              <Select value={form.imageModel || '__default__'} onValueChange={(v) => setForm({ ...form, imageModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">绘图模型 <span className="text-muted-foreground">（生成图片）</span></Label>
              <Select value={form.drawModel || '__default__'} onValueChange={(v) => setForm({ ...form, drawModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">搜索模型 <span className="text-muted-foreground">（联网搜索）</span></Label>
              <Select value={form.searchModel || '__default__'} onValueChange={(v) => setForm({ ...form, searchModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">伪人模型 <span className="text-muted-foreground">（模拟真人）</span></Label>
              <Select value={form.roleplayModel || '__default__'} onValueChange={(v) => setForm({ ...form, roleplayModel: v === '__default__' ? '' : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用全局配置" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  <SelectItem value="__default__">使用全局配置</SelectItem>
                  {allModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <Label>群组知识库</Label>
          </div>
          <p className="text-xs text-muted-foreground">为本群配置专属知识库</p>
          {form.knowledgeIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.knowledgeIds.map((kId) => {
                const doc = knowledgeDocs.find(d => d.id === kId)
                return (
                  <Badge key={kId} variant="secondary" className="gap-1">
                    {doc?.name || kId}
                    <button onClick={() => setForm({ ...form, knowledgeIds: form.knowledgeIds.filter(id => id !== kId) })}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )
              })}
            </div>
          )}
          <Select value="" onValueChange={(v) => v && !form.knowledgeIds.includes(v) && setForm({ ...form, knowledgeIds: [...form.knowledgeIds, v] })}>
            <SelectTrigger>
              <SelectValue placeholder="添加知识库..." />
            </SelectTrigger>
            <SelectContent>
              {knowledgeDocs.filter(d => !form.knowledgeIds.includes(d.id)).map((doc) => (
                <SelectItem key={doc.id} value={doc.id}>{doc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <Label>继承配置</Label>
          </div>
          <p className="text-xs text-muted-foreground">从其他来源继承提示词和知识库</p>
          {form.inheritFrom.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.inheritFrom.map((source) => {
                const [type, id] = source.split(':')
                let label = source
                if (type === 'preset') label = `预设: ${presets.find(p => p.id === id)?.name || id}`
                else if (type === 'group') label = `群: ${groups.find(g => g.groupId === id)?.groupName || id}`
                return (
                  <Badge key={source} variant="outline" className="gap-1">
                    {label}
                    <button onClick={() => setForm({ ...form, inheritFrom: form.inheritFrom.filter(s => s !== source) })}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Select value="" onValueChange={(v) => v && !form.inheritFrom.includes(v) && setForm({ ...form, inheritFrom: [...form.inheritFrom, v] })}>
              <SelectTrigger><SelectValue placeholder="预设..." /></SelectTrigger>
              <SelectContent>
                {presets.filter(p => !form.inheritFrom.includes(`preset:${p.id}`)).map((p) => (
                  <SelectItem key={p.id} value={`preset:${p.id}`}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value="" onValueChange={(v) => v && !form.inheritFrom.includes(v) && setForm({ ...form, inheritFrom: [...form.inheritFrom, v] })}>
              <SelectTrigger><SelectValue placeholder="群组..." /></SelectTrigger>
              <SelectContent>
                {groups.filter(g => g.groupId !== form.groupId && !form.inheritFrom.includes(`group:${g.groupId}`)).map((g) => (
                  <SelectItem key={g.groupId} value={`group:${g.groupId}`}>{g.groupName || g.groupId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 页面头部 */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">群组管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">配置群聊个性化设置和独立人设</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setFormTab('basic'); setDialogOpen(true) }} className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>添加群</span>
            </Button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              "p-3 sm:p-4 rounded-xl border transition-all text-left",
              statusFilter === 'all' ? "border-primary bg-primary/5 shadow-sm" : "hover:border-muted-foreground/30"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">全部</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold">{stats.total}</p>
          </button>
          <button
            onClick={() => setStatusFilter('enabled')}
            className={cn(
              "p-3 sm:p-4 rounded-xl border transition-all text-left",
              statusFilter === 'enabled' ? "border-emerald-500 bg-emerald-500/5 shadow-sm" : "hover:border-muted-foreground/30"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Power className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">已启用</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-emerald-600">{stats.enabled}</p>
          </button>
          <button
            onClick={() => setStatusFilter('disabled')}
            className={cn(
              "p-3 sm:p-4 rounded-xl border transition-all text-left",
              statusFilter === 'disabled' ? "border-zinc-500 bg-zinc-500/5 shadow-sm" : "hover:border-muted-foreground/30"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <PowerOff className="h-4 w-4 text-zinc-400" />
              <span className="text-xs text-muted-foreground">已禁用</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-zinc-500">{stats.disabled}</p>
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索群号或群名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-10"
        />
        {searchQuery && (
          <Button
            variant="ghost" size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
            onClick={() => setSearchQuery('')}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 群组列表 */}
      {filteredGroups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium mb-1">
              {searchQuery || statusFilter !== 'all' ? '未找到匹配的群' : '暂无群配置'}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery ? '尝试其他搜索词' : '添加群组来配置个性化设置'}
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button onClick={() => { resetForm(); setFormTab('basic'); setDialogOpen(true) }}>
                <Plus className="mr-2 h-4 w-4" />
                添加第一个群
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 sm:space-y-3">
          {filteredGroups.map((group) => {
            const isEnabled = group.enabled ?? group.settings?.enabled ?? true
            const modelId = group.settings?.modelId || group.modelId
            const settings = group.settings || {}
            
            return (
              <Card 
                key={group.groupId} 
                className={cn(
                  "group transition-all hover:shadow-md",
                  !isEnabled && "opacity-60"
                )}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    {/* 状态指示器 */}
                    <button
                      onClick={() => handleQuickToggle(group)}
                      disabled={togglingGroup === group.groupId}
                      className={cn(
                        "mt-1 flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        isEnabled 
                          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20" 
                          : "bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20"
                      )}
                    >
                      {togglingGroup === group.groupId ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : isEnabled ? (
                        <Power className="h-5 w-5" />
                      ) : (
                        <PowerOff className="h-5 w-5" />
                      )}
                    </button>

                    {/* 主内容区 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base">{group.groupName || group.groupId}</span>
                        {group.groupName && (
                          <span className="text-xs text-muted-foreground font-mono">#{group.groupId}</span>
                        )}
                        <Badge variant={isEnabled ? 'default' : 'secondary'} className="text-xs">
                          {getStatusText(isEnabled)}
                        </Badge>
                      </div>
                      
                      {/* 配置标签 */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {group.systemPrompt && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal">
                            <FileText className="h-3 w-3" />
                            独立人设
                          </Badge>
                        )}
                        {!group.systemPrompt && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal">
                            <Palette className="h-3 w-3" />
                            {presets.find(p => p.id === group.presetId)?.name || '默认预设'}
                          </Badge>
                        )}
                        {modelId && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal max-w-[140px] truncate">
                            <Bot className="h-3 w-3 flex-shrink-0" />
                            {modelId}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs gap-1 font-normal">
                          <Zap className="h-3 w-3" />
                          {triggerModeNames[group.triggerMode || 'default'] || '默认'}
                        </Badge>
                        {settings.bymEnabled && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal bg-purple-500/10 border-purple-500/30">
                            <Sparkles className="h-3 w-3 text-purple-500" />
                            伪人
                          </Badge>
                        )}
                        {group.knowledgeIds && group.knowledgeIds.length > 0 && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal">
                            <BookOpen className="h-3 w-3" />
                            {group.knowledgeIds.length}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(group)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenDialog(group)}>
                            <Settings className="h-4 w-4 mr-2" />
                            编辑配置
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleQuickToggle(group)}>
                            {isEnabled ? <PowerOff className="h-4 w-4 mr-2" /> : <Power className="h-4 w-4 mr-2" />}
                            {isEnabled ? '禁用群组' : '启用群组'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(group)}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            删除配置
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 编辑对话框 - 桌面端使用 Dialog，移动端使用 Sheet */}
      {isMobile ? (
        <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
            <SheetHeader className="pb-4">
              <SheetTitle>{editingGroup ? '编辑群配置' : '添加群'}</SheetTitle>
              <SheetDescription>配置群聊个性化设置</SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-180px)] pr-4">
              {renderFormContent()}
            </ScrollArea>
            <SheetFooter className="pt-4 flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle>{editingGroup ? '编辑群配置' : '添加群'}</DialogTitle>
              <DialogDescription>配置群聊个性化设置和独立人设</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] pr-4">
              {renderFormContent()}
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除群 <strong>{deletingGroup?.groupName || deletingGroup?.groupId}</strong> 的配置吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
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
