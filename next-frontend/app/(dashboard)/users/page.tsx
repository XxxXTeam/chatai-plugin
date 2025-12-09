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
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Users, RefreshCw, Settings } from 'lucide-react'

interface UserScope {
  userId: string
  nickname?: string
  presetId?: string
  enabled: boolean
  lastActive?: number
  settings?: Record<string, unknown>
}

interface Preset {
  id: string
  name: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserScope[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserScope | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [form, setForm] = useState({
    userId: '',
    nickname: '',
    presetId: '__default__',
    enabled: true,
  })

  const fetchData = async () => {
    try {
      const [usersRes, presetsRes] = await Promise.all([
        api.get('/api/scope/users'),
        api.get('/api/presets/list')
      ])
      setUsers((usersRes as { data: UserScope[] }).data || [])
      setPresets((presetsRes as { data: Preset[] }).data || [])
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
      userId: '',
      nickname: '',
      presetId: '__default__',
      enabled: true,
    })
    setEditingUser(null)
  }

  const handleOpenDialog = (user?: UserScope) => {
    if (user) {
      setEditingUser(user)
      setForm({
        userId: user.userId,
        nickname: user.nickname || '',
        presetId: user.presetId || '__default__',
        enabled: user.enabled ?? true,
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
        enabled: form.enabled,
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

  const handleDelete = async (userId: string) => {
    if (!confirm('确定删除此用户配置？')) return
    try {
      await api.delete(`/api/scope/user/${userId}`)
      toast.success('用户配置已删除')
      fetchData()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '从未'
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const filteredUsers = users.filter(user => 
    user.userId.includes(searchQuery) || 
    user.nickname?.includes(searchQuery)
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
        <h2 className="text-2xl font-bold">用户管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加用户
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingUser ? '编辑用户' : '添加用户'}</DialogTitle>
                <DialogDescription>配置用户个性化设置</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="userId">用户ID (QQ号)</Label>
                  <Input
                    id="userId"
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value })}
                    placeholder="123456789"
                    disabled={!!editingUser}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nickname">备注名</Label>
                  <Input
                    id="nickname"
                    value={form.nickname}
                    onChange={(e) => setForm({ ...form, nickname: e.target.value })}
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
                <div className="flex items-center justify-between">
                  <Label>启用AI响应</Label>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                  />
                </div>
              </div>
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
          placeholder="搜索用户ID或备注名..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {filteredUsers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? '未找到匹配的用户' : '暂无用户配置'}
            </p>
            {!searchQuery && (
              <Button className="mt-4" onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加第一个用户
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="space-y-3">
            {filteredUsers.map((user) => (
              <Card key={user.userId}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{user.userId}</span>
                        {user.nickname && (
                          <span className="text-muted-foreground">({user.nickname})</span>
                        )}
                        <Badge variant={user.enabled ? 'default' : 'secondary'}>
                          {user.enabled ? '已启用' : '已禁用'}
                        </Badge>
                      </div>
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>预设: {presets.find(p => p.id === user.presetId)?.name || '默认'}</span>
                        <span>最后活跃: {formatTime(user.lastActive)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenDialog(user)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(user.userId)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
