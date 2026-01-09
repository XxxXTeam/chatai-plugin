'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { api, channelsApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { 
  Plus, Trash2, Loader2, Users, RefreshCw, Settings, FileText, Bot, 
  ChevronDown, X, Search, Power, PowerOff, Zap, MoreHorizontal
} from 'lucide-react'
import { ModelSelector } from '@/components/ModelSelector'
import { cn } from '@/lib/utils'

interface UserScope {
  userId: string
  nickname?: string
  presetId?: string
  systemPrompt?: string
  modelId?: string
  enabled: boolean
  lastActive?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any
  createdAt?: number
  updatedAt?: number
}

interface Preset {
  id: string
  name: string
}

interface Channel {
  id: string
  name: string
  models?: string[]
}

const getStatusText = (enabled: boolean) => enabled ? '已启用' : '已禁用'

export default function UsersPage() {
  const searchParams = useSearchParams()
  const [users, setUsers] = useState<UserScope[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [, setChannels] = useState<Channel[]>([])
  const [allModels, setAllModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserScope | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingUser, setDeletingUser] = useState<UserScope | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingUser, setTogglingUser] = useState<string | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  
  // 处理URL参数
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'add') {
      resetForm()
      setDialogOpen(true)
    }
  }, [searchParams])

  const [form, setForm] = useState({
    userId: '',
    nickname: '',
    presetId: '__default__',
    systemPrompt: '',
    modelId: '__default__',
    enabled: true,
    // 功能开关
    toolsEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    imageGenEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    summaryEnabled: 'inherit' as 'inherit' | 'on' | 'off',
  })

  const fetchData = async () => {
    try {
      const [usersRes, presetsRes, channelsRes] = await Promise.all([
        api.get('/api/scope/users'),
        presetsApi.list(),
        channelsApi.list()
      ])
      setUsers((usersRes as { data: UserScope[] }).data || [])
      setPresets((presetsRes as { data: Preset[] }).data || [])
      setChannels((channelsRes as { data: Channel[] }).data || [])
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
    // 检测移动端
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const resetForm = () => {
    setForm({
      userId: '',
      nickname: '',
      presetId: '__default__',
      systemPrompt: '',
      modelId: '__default__',
      enabled: true,
      toolsEnabled: 'inherit',
      imageGenEnabled: 'inherit',
      summaryEnabled: 'inherit',
    })
    setEditingUser(null)
  }

  const handleOpenDialog = (user?: UserScope) => {
    if (user) {
      setEditingUser(user)
      const settings = user.settings || {}
      setForm({
        userId: user.userId,
        nickname: settings.nickname || user.nickname || '',
        presetId: user.presetId || settings.presetId || '__default__',
        systemPrompt: user.systemPrompt || settings.systemPrompt || '',
        modelId: settings.modelId || user.modelId || '__default__',
        enabled: user.enabled ?? settings.enabled ?? true,
        toolsEnabled: settings.toolsEnabled === undefined ? 'inherit' : settings.toolsEnabled ? 'on' : 'off',
        imageGenEnabled: settings.imageGenEnabled === undefined ? 'inherit' : settings.imageGenEnabled ? 'on' : 'off',
        summaryEnabled: settings.summaryEnabled === undefined ? 'inherit' : settings.summaryEnabled ? 'on' : 'off',
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.userId) {
      toast.error('请填写用户ID')
      return
    }

    setSaving(true)
    try {
      await api.put(`/api/scope/user/${form.userId}`, {
        nickname: form.nickname,
        presetId: form.presetId === '__default__' ? '' : form.presetId,
        systemPrompt: form.systemPrompt || null,
        modelId: form.modelId === '__default__' ? '' : form.modelId,
        enabled: form.enabled,
        toolsEnabled: form.toolsEnabled === 'inherit' ? undefined : form.toolsEnabled === 'on',
        imageGenEnabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
        summaryEnabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
      })
      toast.success('用户配置已保存')
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
    if (!deletingUser) return
    setDeleting(true)
    try {
      await api.delete(`/api/scope/user/${deletingUser.userId}`)
      toast.success('用户配置已删除')
      setDeleteDialogOpen(false)
      setDeletingUser(null)
      fetchData()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    } finally {
      setDeleting(false)
    }
  }

  const openDeleteDialog = (user: UserScope) => {
    setDeletingUser(user)
    setDeleteDialogOpen(true)
  }

  const handleQuickToggle = async (user: UserScope) => {
    const newEnabled = !(user.enabled ?? user.settings?.enabled ?? true)
    setTogglingUser(user.userId)
    try {
      await api.put(`/api/scope/user/${user.userId}`, { enabled: newEnabled })
      toast.success(newEnabled ? '已启用用户' : '已禁用用户')
      fetchData()
    } catch (error) {
      toast.error('切换失败')
      console.error(error)
    } finally {
      setTogglingUser(null)
    }
  }

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '从未'
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  // 过滤用户
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = user.userId.includes(searchQuery) || 
        user.nickname?.toLowerCase().includes(searchQuery.toLowerCase())
      const isEnabled = user.enabled ?? user.settings?.enabled ?? true
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'enabled' && isEnabled) ||
        (statusFilter === 'disabled' && !isEnabled)
      return matchesSearch && matchesStatus
    })
  }, [users, searchQuery, statusFilter])

  // 统计信息
  const stats = useMemo(() => {
    const total = users.length
    const enabled = users.filter(u => u.enabled ?? u.settings?.enabled ?? true).length
    return { total, enabled, disabled: total - enabled }
  }, [users])

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
    <div className="space-y-4 sm:space-y-6">
      {/* 页面头部 */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">用户管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">配置用户个性化设置和独立人设</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">刷新</span>
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true) }} className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>添加用户</span>
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
          placeholder="搜索用户ID或备注名..."
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

      {/* 用户列表 */}
      {filteredUsers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium mb-1">
              {searchQuery || statusFilter !== 'all' ? '未找到匹配的用户' : '暂无用户配置'}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery ? '尝试其他搜索词' : '添加用户来配置个性化设置'}
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button onClick={() => { resetForm(); setDialogOpen(true) }}>
                <Plus className="mr-2 h-4 w-4" />
                添加第一个用户
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 sm:space-y-3">
          {filteredUsers.map((user) => {
            const isEnabled = user.enabled ?? user.settings?.enabled ?? true
            const modelId = user.settings?.modelId || user.modelId
            
            return (
              <Card 
                key={user.userId} 
                className={cn(
                  "group transition-all hover:shadow-md",
                  !isEnabled && "opacity-60"
                )}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    {/* 状态指示器 */}
                    <button
                      onClick={() => handleQuickToggle(user)}
                      disabled={togglingUser === user.userId}
                      className={cn(
                        "mt-1 flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                        isEnabled 
                          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20" 
                          : "bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20"
                      )}
                    >
                      {togglingUser === user.userId ? (
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
                        <span className="font-semibold text-base">{user.nickname || user.userId}</span>
                        {user.nickname && (
                          <span className="text-xs text-muted-foreground font-mono">#{user.userId}</span>
                        )}
                        <Badge variant={isEnabled ? 'default' : 'secondary'} className="text-xs">
                          {getStatusText(isEnabled)}
                        </Badge>
                      </div>
                      
                      {/* 配置标签 */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {user.systemPrompt && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal">
                            <FileText className="h-3 w-3" />
                            独立人设
                          </Badge>
                        )}
                        {!user.systemPrompt && (
                          <Badge variant="outline" className="text-xs gap-1 font-normal">
                            {presets.find(p => p.id === user.presetId)?.name || '默认预设'}
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
                          {formatTime(user.lastActive)}
                        </Badge>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(user)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleOpenDialog(user)}>
                            <Settings className="h-4 w-4 mr-2" />
                            编辑配置
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleQuickToggle(user)}>
                            {isEnabled ? <PowerOff className="h-4 w-4 mr-2" /> : <Power className="h-4 w-4 mr-2" />}
                            {isEnabled ? '禁用用户' : '启用用户'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(user)}>
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

      {/* 编辑对话框 */}
      {isMobile ? (
        <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
            <SheetHeader className="pb-4">
              <SheetTitle>{editingUser ? '编辑用户' : '添加用户'}</SheetTitle>
              <SheetDescription>配置用户个性化设置</SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-180px)] pr-4">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>用户ID (QQ号) *</Label>
                    <Input
                      value={form.userId}
                      onChange={(e) => setForm({ ...form, userId: e.target.value })}
                      placeholder="123456789"
                      disabled={!!editingUser}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>备注名</Label>
                    <Input
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
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
                    <Label>使用模型</Label>
                    <Collapsible open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between">
                          <span className="truncate">
                            {form.modelId && form.modelId !== '__default__' ? form.modelId : '使用默认模型'}
                          </span>
                          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", modelSelectorOpen && "rotate-180")} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="border rounded-lg p-3 space-y-2">
                          <Button 
                            variant="ghost" size="sm" className="w-full justify-start text-muted-foreground"
                            onClick={() => { setForm({ ...form, modelId: '__default__' }); setModelSelectorOpen(false) }}
                          >
                            使用默认模型
                          </Button>
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
                </div>

                <div className="space-y-2">
                  <Label>独立人设</Label>
                  <Textarea
                    value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="不填写则使用预设配置..."
                    rows={4}
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
              </div>
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
          <DialogContent className="max-w-xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle>{editingUser ? '编辑用户' : '添加用户'}</DialogTitle>
              <DialogDescription>配置用户个性化设置和独立人设</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>用户ID (QQ号) *</Label>
                    <Input
                      value={form.userId}
                      onChange={(e) => setForm({ ...form, userId: e.target.value })}
                      placeholder="123456789"
                      disabled={!!editingUser}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>备注名</Label>
                    <Input
                      value={form.nickname}
                      onChange={(e) => setForm({ ...form, nickname: e.target.value })}
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
                    <Label>使用模型</Label>
                    <Collapsible open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between">
                          <span className="truncate">
                            {form.modelId && form.modelId !== '__default__' ? form.modelId : '使用默认模型'}
                          </span>
                          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", modelSelectorOpen && "rotate-180")} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="border rounded-lg p-3 space-y-2">
                          <Button 
                            variant="ghost" size="sm" className="w-full justify-start text-muted-foreground"
                            onClick={() => { setForm({ ...form, modelId: '__default__' }); setModelSelectorOpen(false) }}
                          >
                            使用默认模型
                          </Button>
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
                </div>

                <div className="space-y-2">
                  <Label>独立人设</Label>
                  <Textarea
                    value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="不填写则使用预设配置..."
                    rows={4}
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
              </div>
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
      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="删除用户配置"
        itemName={deletingUser?.nickname || deletingUser?.userId}
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
