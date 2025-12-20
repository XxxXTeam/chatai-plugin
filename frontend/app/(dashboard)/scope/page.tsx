'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Edit,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  UsersRound,
  User,
} from 'lucide-react'
import { scopeApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'

interface ScopeItem {
  userId?: string
  groupId?: string
  systemPrompt?: string
  presetId?: string
  updatedAt?: string
}

interface PriorityConfig {
  priority: string[]
  useIndependent: boolean
}

const priorityOptions = [
  { value: 'group', label: '群聊人格 (group)', description: '特定群组的人格设定' },
  { value: 'group_user', label: '群内用户人格 (group_user)', description: '特定群内特定用户的人格' },
  { value: 'private', label: '私聊人格 (private)', description: '用户在私聊场景的人格' },
  { value: 'user', label: '用户全局人格 (user)', description: '用户在所有场景的人格' },
  { value: 'default', label: '默认预设 (default)', description: '系统默认预设' },
]

export default function ScopeManagerPage() {
  const [loading, setLoading] = useState(true)
  const [userScopes, setUserScopes] = useState<ScopeItem[]>([])
  const [groupScopes, setGroupScopes] = useState<ScopeItem[]>([])
  const [groupUserScopes, setGroupUserScopes] = useState<ScopeItem[]>([])
  const [privateScopes, setPrivateScopes] = useState<ScopeItem[]>([])
  const [presets, setPresets] = useState<{id: string, name: string}[]>([])

  // 优先级配置
  const [priorityConfig, setPriorityConfig] = useState<PriorityConfig>({
    priority: ['group', 'group_user', 'private', 'user', 'default'],
    useIndependent: true,
  })
  const [savingPriority, setSavingPriority] = useState(false)

  // 弹窗状态
  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [groupUserDialogOpen, setGroupUserDialogOpen] = useState(false)
  const [privateDialogOpen, setPrivateDialogOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)

  // 表单
  const [userForm, setUserForm] = useState({ userId: '', systemPrompt: '', presetId: '' })
  const [groupForm, setGroupForm] = useState({ groupId: '', systemPrompt: '', presetId: '' })
  const [groupUserForm, setGroupUserForm] = useState({ groupId: '', userId: '', systemPrompt: '', presetId: '' })
  const [privateForm, setPrivateForm] = useState({ userId: '', systemPrompt: '', presetId: '' })

  // 搜索功能
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searching, setSearching] = useState(false)

  // 过滤后的数据
  const filteredUserScopes = searchKeyword 
    ? userScopes.filter(s => s.userId?.includes(searchKeyword) || s.systemPrompt?.includes(searchKeyword))
    : userScopes
  const filteredGroupScopes = searchKeyword
    ? groupScopes.filter(s => s.groupId?.includes(searchKeyword) || s.systemPrompt?.includes(searchKeyword))
    : groupScopes
  const filteredGroupUserScopes = searchKeyword
    ? groupUserScopes.filter(s => s.groupId?.includes(searchKeyword) || s.userId?.includes(searchKeyword) || s.systemPrompt?.includes(searchKeyword))
    : groupUserScopes
  const filteredPrivateScopes = searchKeyword
    ? privateScopes.filter(s => s.userId?.includes(searchKeyword) || s.systemPrompt?.includes(searchKeyword))
    : privateScopes

  // 加载数据
  const loadData = async () => {
    setLoading(true)
    try {
      const [usersRes, groupsRes, groupUsersRes, privatesRes, presetsRes, configRes] = await Promise.all([
        scopeApi.getUsers().catch(() => ({ data: [] })),
        scopeApi.getGroups().catch(() => ({ data: [] })),
        scopeApi.getGroupUsers().catch(() => ({ data: [] })),
        scopeApi.getPrivates().catch(() => ({ data: [] })),
        presetsApi.list().catch(() => ({ data: [] })),
        scopeApi.getPersonalityConfig().catch(() => ({ data: null })),
      ])

      setUserScopes((usersRes as any)?.data || [])
      setGroupScopes((groupsRes as any)?.data || [])
      setGroupUserScopes((groupUsersRes as any)?.data || [])
      setPrivateScopes((privatesRes as any)?.data || [])
      setPresets((presetsRes as any)?.data || [])

      if ((configRes as any)?.data) {
        setPriorityConfig({
          priority: (configRes as any).data.priority || ['group', 'group_user', 'user', 'default'],
          useIndependent: (configRes as any).data.useIndependent !== false,
        })
      }
    } catch (error) {
      toast.error('加载数据失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // 保存优先级配置
  const savePriorityConfig = async () => {
    setSavingPriority(true)
    try {
      await scopeApi.updatePersonalityConfig(priorityConfig)
      toast.success('优先级配置已保存')
    } catch (error) {
      toast.error('保存失败')
    } finally {
      setSavingPriority(false)
    }
  }

  // 调整优先级顺序
  const movePriority = (index: number, direction: number) => {
    const arr = [...priorityConfig.priority]
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= arr.length) return
    ;[arr[index], arr[newIndex]] = [arr[newIndex], arr[index]]
    setPriorityConfig({ ...priorityConfig, priority: arr })
  }

  // 获取优先级显示
  const priorityDisplay = priorityConfig.priority.map(p => {
    const opt = priorityOptions.find(o => o.value === p)
    return opt ? opt.label : p
  }).join(' > ')

  // 用户操作
  const openUserDialog = (item?: ScopeItem) => {
    if (item) {
      setEditMode(true)
      setUserForm({ userId: item.userId || '', systemPrompt: item.systemPrompt || '', presetId: item.presetId || '' })
    } else {
      setEditMode(false)
      setUserForm({ userId: '', systemPrompt: '', presetId: '' })
    }
    setUserDialogOpen(true)
  }

  const saveUser = async () => {
    if (!userForm.userId) {
      toast.warning('请输入用户ID')
      return
    }
    try {
      await scopeApi.updateUser(userForm.userId, {
        systemPrompt: userForm.systemPrompt,
        presetId: userForm.presetId,
      })
      toast.success('保存成功')
      setUserDialogOpen(false)
      loadData()
    } catch (error) {
      toast.error('保存失败')
    }
  }

  const deleteUser = async (userId: string) => {
    try {
      await scopeApi.deleteUser(userId)
      toast.success('删除成功')
      loadData()
    } catch (error) {
      toast.error('删除失败')
    }
  }

  // 群组操作
  const openGroupDialog = (item?: ScopeItem) => {
    if (item) {
      setEditMode(true)
      setGroupForm({ groupId: item.groupId || '', systemPrompt: item.systemPrompt || '', presetId: item.presetId || '' })
    } else {
      setEditMode(false)
      setGroupForm({ groupId: '', systemPrompt: '', presetId: '' })
    }
    setGroupDialogOpen(true)
  }

  const saveGroup = async () => {
    if (!groupForm.groupId) {
      toast.warning('请输入群组ID')
      return
    }
    try {
      await scopeApi.updateGroup(groupForm.groupId, {
        systemPrompt: groupForm.systemPrompt,
        presetId: groupForm.presetId,
      })
      toast.success('保存成功')
      setGroupDialogOpen(false)
      loadData()
    } catch (error) {
      toast.error('保存失败')
    }
  }

  const deleteGroup = async (groupId: string) => {
    try {
      await scopeApi.deleteGroup(groupId)
      toast.success('删除成功')
      loadData()
    } catch (error) {
      toast.error('删除失败')
    }
  }

  // 群内用户操作
  const openGroupUserDialog = (item?: ScopeItem) => {
    if (item) {
      setEditMode(true)
      setGroupUserForm({
        groupId: item.groupId || '',
        userId: item.userId || '',
        systemPrompt: item.systemPrompt || '',
        presetId: item.presetId || '',
      })
    } else {
      setEditMode(false)
      setGroupUserForm({ groupId: '', userId: '', systemPrompt: '', presetId: '' })
    }
    setGroupUserDialogOpen(true)
  }

  const saveGroupUser = async () => {
    if (!groupUserForm.groupId || !groupUserForm.userId) {
      toast.warning('请输入群组ID和用户ID')
      return
    }
    try {
      await scopeApi.updateGroupUser(groupUserForm.groupId, groupUserForm.userId, {
        systemPrompt: groupUserForm.systemPrompt,
        presetId: groupUserForm.presetId,
      })
      toast.success('保存成功')
      setGroupUserDialogOpen(false)
      loadData()
    } catch (error) {
      toast.error('保存失败')
    }
  }

  const deleteGroupUser = async (groupId: string, userId: string) => {
    try {
      await scopeApi.deleteGroupUser(groupId, userId)
      toast.success('删除成功')
      loadData()
    } catch (error) {
      toast.error('删除失败')
    }
  }

  // 私聊操作
  const openPrivateDialog = (item?: ScopeItem) => {
    if (item) {
      setEditMode(true)
      setPrivateForm({ userId: item.userId || '', systemPrompt: item.systemPrompt || '', presetId: item.presetId || '' })
    } else {
      setEditMode(false)
      setPrivateForm({ userId: '', systemPrompt: '', presetId: '' })
    }
    setPrivateDialogOpen(true)
  }

  const savePrivate = async () => {
    if (!privateForm.userId) {
      toast.warning('请输入用户ID')
      return
    }
    try {
      await scopeApi.updatePrivate(privateForm.userId, {
        systemPrompt: privateForm.systemPrompt,
        presetId: privateForm.presetId,
      })
      toast.success('保存成功')
      setPrivateDialogOpen(false)
      loadData()
    } catch (error) {
      toast.error('保存失败')
    }
  }

  const deletePrivate = async (userId: string) => {
    try {
      await scopeApi.deletePrivate(userId)
      toast.success('删除成功')
      loadData()
    } catch (error) {
      toast.error('删除失败')
    }
  }

  const totalCount = userScopes.length + groupScopes.length + groupUserScopes.length + privateScopes.length

  return (
    <div className="space-y-6">
      {/* 优先级配置 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>人格优先级配置</CardTitle>
            <CardDescription>配置不同作用域人格的优先级顺序</CardDescription>
          </div>
          <Button onClick={savePriorityConfig} disabled={savingPriority}>
            {savingPriority && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            保存配置
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-700 dark:text-blue-300">
              当多个作用域都设置了人格时，按以下优先级选择第一个有效的人格。<br />
              当前优先级: <strong>{priorityDisplay}</strong>
            </div>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <Label>启用独立人格</Label>
              <p className="text-sm text-muted-foreground">开启后，找到的人格将完全替换默认预设，而不是拼接</p>
            </div>
            <Switch
              checked={priorityConfig.useIndependent}
              onCheckedChange={(checked) => setPriorityConfig({ ...priorityConfig, useIndependent: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label>优先级顺序（从高到低）</Label>
            <div className="space-y-2">
              {priorityConfig.priority.map((item, index) => {
                const opt = priorityOptions.find(o => o.value === item)
                return (
                  <div key={item} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <div className="w-7 h-7 flex items-center justify-center bg-primary text-primary-foreground rounded-full font-bold text-sm">
                      {index + 1}
                    </div>
                    <Badge variant={item === 'default' ? 'secondary' : 'default'} className="text-sm">
                      {opt?.label || item}
                    </Badge>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => movePriority(index, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={index === priorityConfig.priority.length - 1} onClick={() => movePriority(index, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <span className="text-sm text-muted-foreground ml-auto">{opt?.description}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 人格设定管理 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>人格设定管理</CardTitle>
            <CardDescription>管理用户、群组、群内用户的独立人格</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="搜索 ID 或 Prompt..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="w-48"
            />
            <Badge variant="outline">共 {totalCount} 条</Badge>
            <Button variant="outline" onClick={loadData} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="user">
            <TabsList className="mb-4">
              <TabsTrigger value="user" className="gap-2">
                <User className="h-4 w-4" />
                用户人格 ({filteredUserScopes.length}{searchKeyword && userScopes.length !== filteredUserScopes.length ? `/${userScopes.length}` : ''})
              </TabsTrigger>
              <TabsTrigger value="group" className="gap-2">
                <UsersRound className="h-4 w-4" />
                群组人格 ({filteredGroupScopes.length}{searchKeyword && groupScopes.length !== filteredGroupScopes.length ? `/${groupScopes.length}` : ''})
              </TabsTrigger>
              <TabsTrigger value="groupUser" className="gap-2">
                <Users className="h-4 w-4" />
                群内用户人格 ({filteredGroupUserScopes.length}{searchKeyword && groupUserScopes.length !== filteredGroupUserScopes.length ? `/${groupUserScopes.length}` : ''})
              </TabsTrigger>
              <TabsTrigger value="private" className="gap-2">
                <User className="h-4 w-4" />
                私聊人格 ({filteredPrivateScopes.length}{searchKeyword && privateScopes.length !== filteredPrivateScopes.length ? `/${privateScopes.length}` : ''})
              </TabsTrigger>
            </TabsList>

            {/* 用户人格 */}
            <TabsContent value="user">
              <div className="space-y-4">
                <Button onClick={() => openUserDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加用户人格
                </Button>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户ID</TableHead>
                      <TableHead>自定义Prompt</TableHead>
                      <TableHead>预设</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUserScopes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {searchKeyword ? '没有匹配的用户人格设定' : '暂无用户人格设定'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUserScopes.map((item) => (
                        <TableRow key={item.userId}>
                          <TableCell className="font-medium">{item.userId}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.systemPrompt || '-'}</TableCell>
                          <TableCell>{item.presetId || '-'}</TableCell>
                          <TableCell>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openUserDialog(item)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deleteUser(item.userId!)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* 群组人格 */}
            <TabsContent value="group">
              <div className="space-y-4">
                <Button onClick={() => openGroupDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加群组人格
                </Button>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>群组ID</TableHead>
                      <TableHead>自定义Prompt</TableHead>
                      <TableHead>预设</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGroupScopes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {searchKeyword ? '没有匹配的群组人格设定' : '暂无群组人格设定'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredGroupScopes.map((item) => (
                        <TableRow key={item.groupId}>
                          <TableCell className="font-medium">{item.groupId}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.systemPrompt || '-'}</TableCell>
                          <TableCell>{item.presetId || '-'}</TableCell>
                          <TableCell>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openGroupDialog(item)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deleteGroup(item.groupId!)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* 群内用户人格 */}
            <TabsContent value="groupUser">
              <div className="space-y-4">
                <Button onClick={() => openGroupUserDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加群内用户人格
                </Button>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>群组ID</TableHead>
                      <TableHead>用户ID</TableHead>
                      <TableHead>自定义Prompt</TableHead>
                      <TableHead>预设</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGroupUserScopes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {searchKeyword ? '没有匹配的群内用户人格设定' : '暂无群内用户人格设定'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredGroupUserScopes.map((item) => (
                        <TableRow key={`${item.groupId}-${item.userId}`}>
                          <TableCell className="font-medium">{item.groupId}</TableCell>
                          <TableCell>{item.userId}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.systemPrompt || '-'}</TableCell>
                          <TableCell>{item.presetId || '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openGroupUserDialog(item)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deleteGroupUser(item.groupId!, item.userId!)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* 私聊人格 */}
            <TabsContent value="private">
              <div className="space-y-4">
                <Button onClick={() => openPrivateDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加私聊人格
                </Button>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户ID</TableHead>
                      <TableHead>自定义Prompt</TableHead>
                      <TableHead>预设</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPrivateScopes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {searchKeyword ? '没有匹配的私聊人格设定' : '暂无私聊人格设定'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPrivateScopes.map((item) => (
                        <TableRow key={item.userId}>
                          <TableCell className="font-medium">{item.userId}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.systemPrompt || '-'}</TableCell>
                          <TableCell>{item.presetId || '-'}</TableCell>
                          <TableCell>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => openPrivateDialog(item)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deletePrivate(item.userId!)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 用户人格弹窗 */}
      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editMode ? '编辑用户人格' : '添加用户人格'}</DialogTitle>
            <DialogDescription>为特定用户设置独立的人格</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>用户ID *</Label>
              <Input
                value={userForm.userId}
                onChange={(e) => setUserForm({ ...userForm, userId: e.target.value })}
                placeholder="QQ号"
                disabled={editMode}
              />
            </div>
            <div className="space-y-2">
              <Label>自定义Prompt</Label>
              <Textarea
                value={userForm.systemPrompt}
                onChange={(e) => setUserForm({ ...userForm, systemPrompt: e.target.value })}
                placeholder="为该用户设置专属的系统提示词..."
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label>使用预设</Label>
              <Select
                value={userForm.presetId || '__none__'}
                onValueChange={(v) => setUserForm({ ...userForm, presetId: v === '__none__' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择预设（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不使用预设</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserDialogOpen(false)}>取消</Button>
            <Button onClick={saveUser}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 群组人格弹窗 */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editMode ? '编辑群组人格' : '添加群组人格'}</DialogTitle>
            <DialogDescription>为特定群组设置独立的人格</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>群组ID *</Label>
              <Input
                value={groupForm.groupId}
                onChange={(e) => setGroupForm({ ...groupForm, groupId: e.target.value })}
                placeholder="群号"
                disabled={editMode}
              />
            </div>
            <div className="space-y-2">
              <Label>自定义Prompt</Label>
              <Textarea
                value={groupForm.systemPrompt}
                onChange={(e) => setGroupForm({ ...groupForm, systemPrompt: e.target.value })}
                placeholder="为该群组设置专属的系统提示词..."
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label>使用预设</Label>
              <Select
                value={groupForm.presetId || '__none__'}
                onValueChange={(v) => setGroupForm({ ...groupForm, presetId: v === '__none__' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择预设（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不使用预设</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>取消</Button>
            <Button onClick={saveGroup}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 群内用户人格弹窗 */}
      <Dialog open={groupUserDialogOpen} onOpenChange={setGroupUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editMode ? '编辑群内用户人格' : '添加群内用户人格'}</DialogTitle>
            <DialogDescription>为特定群内的特定用户设置独立的人格</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>群组ID *</Label>
                <Input
                  value={groupUserForm.groupId}
                  onChange={(e) => setGroupUserForm({ ...groupUserForm, groupId: e.target.value })}
                  placeholder="群号"
                  disabled={editMode}
                />
              </div>
              <div className="space-y-2">
                <Label>用户ID *</Label>
                <Input
                  value={groupUserForm.userId}
                  onChange={(e) => setGroupUserForm({ ...groupUserForm, userId: e.target.value })}
                  placeholder="QQ号"
                  disabled={editMode}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>自定义Prompt</Label>
              <Textarea
                value={groupUserForm.systemPrompt}
                onChange={(e) => setGroupUserForm({ ...groupUserForm, systemPrompt: e.target.value })}
                placeholder="为该群内的特定用户设置专属的系统提示词..."
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label>使用预设</Label>
              <Select
                value={groupUserForm.presetId || '__none__'}
                onValueChange={(v) => setGroupUserForm({ ...groupUserForm, presetId: v === '__none__' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择预设（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不使用预设</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupUserDialogOpen(false)}>取消</Button>
            <Button onClick={saveGroupUser}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 私聊人格弹窗 */}
      <Dialog open={privateDialogOpen} onOpenChange={setPrivateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editMode ? '编辑私聊人格' : '添加私聊人格'}</DialogTitle>
            <DialogDescription>为特定用户在私聊场景设置独立的人格</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>用户ID *</Label>
              <Input
                value={privateForm.userId}
                onChange={(e) => setPrivateForm({ ...privateForm, userId: e.target.value })}
                placeholder="QQ号"
                disabled={editMode}
              />
            </div>
            <div className="space-y-2">
              <Label>自定义Prompt</Label>
              <Textarea
                value={privateForm.systemPrompt}
                onChange={(e) => setPrivateForm({ ...privateForm, systemPrompt: e.target.value })}
                placeholder="为该用户在私聊场景设置专属的系统提示词..."
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label>使用预设</Label>
              <Select
                value={privateForm.presetId || '__none__'}
                onValueChange={(v) => setPrivateForm({ ...privateForm, presetId: v === '__none__' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择预设（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不使用预设</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name || p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrivateDialogOpen(false)}>取消</Button>
            <Button onClick={savePrivate}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
