'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { scopeApi, presetsApi, channelsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Users, RefreshCw, Settings, FileText, Bot } from 'lucide-react'

interface GroupScope {
  groupId: string
  groupName?: string
  presetId?: string
  systemPrompt?: string
  modelId?: string
  enabled: boolean
  triggerMode?: string
  settings?: any
  createdAt?: number
  updatedAt?: number
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
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupScope | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<GroupScope | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [form, setForm] = useState({
    groupId: '',
    groupName: '',
    presetId: '__default__',
    systemPrompt: '',
    modelId: '__default__',
    enabled: true,
    triggerMode: 'default',
  })

  const fetchData = async () => {
    try {
      const [groupsRes, presetsRes, channelsRes]: any[] = await Promise.all([
        scopeApi.getGroups(),
        presetsApi.list(),
        channelsApi.list()
      ])
      setGroups(groupsRes?.data || [])
      setPresets(presetsRes?.data || [])
      setChannels(channelsRes?.data || [])
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
    })
    setEditingGroup(null)
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
      <div className="flex items-center justify-between">
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
            <DialogContent className="max-w-2xl max-h-[90vh]">
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
                  <Select
                    value={form.modelId}
                    onValueChange={(value) => setForm({ ...form, modelId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="使用默认模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">使用默认模型</SelectItem>
                      {channels.map((channel) => (
                        channel.models?.map((model) => (
                          <SelectItem key={`${channel.id}:${model}`} value={model}>
                            [{channel.name}] {model}
                          </SelectItem>
                        ))
                      ))}
                    </SelectContent>
                  </Select>
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
                    独立人设 <span className="text-xs text-muted-foreground">(设置后将完全替代默认预设)</span>
                  </Label>
                  <Textarea
                    id="systemPrompt"
                    value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="不填写则使用预设配置...​

示例：
你是本群的AI助手，会称呼群友为“大佬”。"
                    rows={6}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    设置后，此群的所有对话都将使用这个人设。清空则恢复使用预设。
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <Label>启用AI响应</Label>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                  />
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
          className="max-w-sm"
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
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="space-y-3">
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
