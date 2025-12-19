'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  AlertCircle,
  Cloud,
  Download,
  Image,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Wand2,
  Globe,
  Box,
  X,
  Server,
} from 'lucide-react'
import { imageGenApi, channelsApi } from '@/lib/api'
import { toast } from 'sonner'

interface Preset {
  keywords: string[]
  prompt: string
  needImage: boolean
  source: string
  uid?: string
}

interface PresetSource {
  name: string
  url: string
  enabled: boolean
}

interface ApiConfig {
  baseUrl: string
  apiKey: string
  models?: string[]
}

interface ImageGenConfig {
  enabled: boolean
  model: string
  videoModel: string
  timeout: number
  maxImages: number
  apis: ApiConfig[]
  presetSources: PresetSource[]
  customPresets: Preset[]
}

interface Stats {
  builtin: number
  remote: number
  custom: number
  total: number
  sources: Array<{ name: string; count: number }>
}

export default function ImageGenPage() {
  const [loading, setLoading] = useState(true)
  const [presets, setPresets] = useState<Preset[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [config, setConfig] = useState<ImageGenConfig | null>(null)
  const [updating, setUpdating] = useState(false)
  const [activeTab, setActiveTab] = useState('presets')  // 受控 Tab

  // 弹窗状态
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  const [addPresetOpen, setAddPresetOpen] = useState(false)
  const [editPresetOpen, setEditPresetOpen] = useState(false)
  const [newSource, setNewSource] = useState({ name: '', url: '', enabled: true })
  const [newPreset, setNewPreset] = useState({ keywords: '', prompt: '', needImage: true })
  const [editingPreset, setEditingPreset] = useState<{
    uid: string
    source: string
    keywords: string
    prompt: string
    needImage: boolean
  } | null>(null)

  // 加载数据（showLoading 控制是否显示加载状态）
  const loadData = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const [presetsRes, configRes] = await Promise.all([
        imageGenApi.getPresets(),
        imageGenApi.getConfig(),
      ])
      setPresets(presetsRes.data?.presets || [])
      setStats(presetsRes.data?.stats || null)
      setConfig(configRes.data || null)
    } catch (error: any) {
      toast.error('加载失败', { description: error.message })
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // 热重载预设
  const handleReload = async () => {
    setUpdating(true)
    try {
      const res = await imageGenApi.reloadPresets()
      setStats(res.data?.stats || null)
      toast.success('预设重载成功')
      await loadData(false)
    } catch (error: any) {
      toast.error('重载失败', { description: error.message })
    } finally {
      setUpdating(false)
    }
  }

  // 从云端更新
  const handleUpdate = async () => {
    setUpdating(true)
    try {
      const res = await imageGenApi.updatePresets()
      const results = res.data?.results || []
      const successCount = results.filter((r: any) => r.success).length
      toast.success(`更新完成`, { description: `成功 ${successCount}/${results.length} 个来源` })
      await loadData(false)
    } catch (error: any) {
      toast.error('更新失败', { description: error.message })
    } finally {
      setUpdating(false)
    }
  }

  // 添加预设来源
  const handleAddSource = async () => {
    if (!newSource.name || !newSource.url) {
      toast.error('请填写完整信息')
      return
    }
    try {
      await imageGenApi.addSource(newSource)
      toast.success('来源添加成功')
      setAddSourceOpen(false)
      setNewSource({ name: '', url: '', enabled: true })
      await loadData(false)
    } catch (error: any) {
      toast.error('添加失败', { description: error.message })
    }
  }

  // 删除预设来源
  const handleDeleteSource = async (index: number) => {
    try {
      await imageGenApi.deleteSource(index)
      toast.success('来源已删除')
      await loadData(false)
    } catch (error: any) {
      toast.error('删除失败', { description: error.message })
    }
  }

  // 添加自定义预设
  const handleAddPreset = async () => {
    if (!newPreset.keywords || !newPreset.prompt) {
      toast.error('请填写完整信息')
      return
    }
    try {
      const keywords = newPreset.keywords.split(/[,，\s]+/).filter(k => k.trim())
      await imageGenApi.addCustomPreset({
        keywords,
        prompt: newPreset.prompt,
        needImage: newPreset.needImage,
      })
      toast.success('预设添加成功')
      setAddPresetOpen(false)
      setNewPreset({ keywords: '', prompt: '', needImage: true })
      await loadData(false)
    } catch (error: any) {
      toast.error('添加失败', { description: error.message })
    }
  }

  // 删除自定义预设
  const handleDeletePreset = async (index: number) => {
    try {
      await imageGenApi.deleteCustomPreset(index)
      toast.success('预设已删除')
      await loadData(false)
    } catch (error: any) {
      toast.error('删除失败', { description: error.message })
    }
  }

  // 删除内置预设
  const handleDeleteBuiltinPreset = async (uid: string) => {
    try {
      await imageGenApi.deleteBuiltinPreset(uid)
      toast.success('预设已删除')
      await loadData(false)
    } catch (error: any) {
      toast.error('删除失败', { description: error.message })
    }
  }

  // 删除云端预设
  const handleDeleteRemotePreset = async (source: string, uid: string) => {
    try {
      await imageGenApi.deleteRemotePreset(source, uid)
      toast.success('预设已删除')
      await loadData(false)
    } catch (error: any) {
      toast.error('删除失败', { description: error.message })
    }
  }

  // 打开编辑预设弹窗
  const openEditPreset = (preset: Preset) => {
    setEditingPreset({
      uid: preset.uid || '',
      source: preset.source,
      keywords: preset.keywords.join(', '),
      prompt: preset.prompt,
      needImage: preset.needImage
    })
    setEditPresetOpen(true)
  }

  // 保存编辑的预设
  const handleSavePreset = async () => {
    if (!editingPreset) return
    
    if (!editingPreset.keywords || !editingPreset.prompt) {
      toast.error('请填写完整信息')
      return
    }
    
    try {
      const keywords = editingPreset.keywords.split(/[,，\s]+/).filter(k => k.trim())
      const data = {
        keywords,
        prompt: editingPreset.prompt,
        needImage: editingPreset.needImage
      }
      
      if (editingPreset.source === 'custom') {
        await imageGenApi.updateCustomPreset(editingPreset.uid, data)
      } else if (editingPreset.source === 'builtin') {
        await imageGenApi.updateBuiltinPreset(editingPreset.uid, data)
      } else {
        await imageGenApi.updateRemotePreset(editingPreset.source, editingPreset.uid, data)
      }
      
      toast.success('预设已更新')
      setEditPresetOpen(false)
      setEditingPreset(null)
      await loadData(false)
    } catch (error: any) {
      toast.error('保存失败', { description: error.message })
    }
  }

  // 更新配置（不重新加载整个页面，直接更新本地 state）
  const handleUpdateConfig = async (updates: Partial<ImageGenConfig>) => {
    try {
      await imageGenApi.updateConfig(updates)
      setConfig(c => c ? { ...c, ...updates } : c)
      toast.success('配置已保存')
    } catch (error: any) {
      toast.error('保存失败', { description: error.message })
    }
  }

  // 获取来源徽章颜色
  const getSourceBadge = (source: string) => {
    if (source === 'builtin') return <Badge variant="secondary"><Box className="w-3 h-3 mr-1" />内置</Badge>
    if (source === 'custom') return <Badge variant="default"><Pencil className="w-3 h-3 mr-1" />自定义</Badge>
    return <Badge variant="outline"><Cloud className="w-3 h-3 mr-1" />{source}</Badge>
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wand2 className="h-8 w-8" />
            绘图预设管理
          </h1>
          <p className="text-muted-foreground mt-1">管理 AI 绘图的预设模板和来源</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReload} disabled={updating}>
            {updating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            重载预设
          </Button>
          <Button onClick={handleUpdate} disabled={updating}>
            {updating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            从云端更新
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">总预设数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">内置预设</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats?.builtin || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">云端预设</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.remote || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">自定义预设</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats?.custom || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* 主内容 */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="presets">预设列表</TabsTrigger>
          <TabsTrigger value="sources">预设来源</TabsTrigger>
          <TabsTrigger value="custom">自定义预设</TabsTrigger>
          <TabsTrigger value="settings">基础设置</TabsTrigger>
        </TabsList>

        {/* 预设列表 */}
        <TabsContent value="presets">
          <Card>
            <CardHeader>
              <CardTitle>所有预设</CardTitle>
              <CardDescription>当前已加载的所有绘图预设模板</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-48">关键词</TableHead>
                      <TableHead>提示词</TableHead>
                      <TableHead className="w-24">需要图片</TableHead>
                      <TableHead className="w-32">来源</TableHead>
                      <TableHead className="w-16">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {presets.map((preset, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-muted-foreground">{index + 1}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {preset.keywords.map((kw, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <p className="truncate text-sm text-muted-foreground" title={preset.prompt}>
                            {preset.prompt.substring(0, 100)}...
                          </p>
                        </TableCell>
                        <TableCell>
                          {preset.needImage ? (
                            <Badge variant="secondary"><Image className="w-3 h-3 mr-1" />需要</Badge>
                          ) : (
                            <Badge variant="outline">不需要</Badge>
                          )}
                        </TableCell>
                        <TableCell>{getSourceBadge(preset.source)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {preset.uid && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditPreset(preset)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {preset.source === 'custom' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  const customIndex = config?.customPresets?.findIndex(p => p.uid === preset.uid)
                                  if (customIndex !== undefined && customIndex >= 0) {
                                    handleDeletePreset(customIndex)
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                            {preset.source === 'builtin' && preset.uid && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteBuiltinPreset(preset.uid!)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                            {preset.source !== 'builtin' && preset.source !== 'custom' && preset.uid && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteRemotePreset(preset.source, preset.uid!)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 预设来源 */}
        <TabsContent value="sources">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>预设来源</CardTitle>
                <CardDescription>管理远程预设数据源</CardDescription>
              </div>
              <Button onClick={() => setAddSourceOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                添加来源
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-24">状态</TableHead>
                    <TableHead className="w-24">预设数</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config?.presetSources?.map((source, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{source.name}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{source.url}</TableCell>
                      <TableCell>
                        {source.enabled ? (
                          <Badge variant="default">启用</Badge>
                        ) : (
                          <Badge variant="secondary">禁用</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {stats?.sources?.find(s => s.name === source.name)?.count || 0}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteSource(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!config?.presetSources || config.presetSources.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        暂无预设来源，点击上方按钮添加
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 自定义预设 */}
        <TabsContent value="custom">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>自定义预设</CardTitle>
                <CardDescription>创建自己的绘图预设模板</CardDescription>
              </div>
              <Button onClick={() => setAddPresetOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                添加预设
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">关键词</TableHead>
                    <TableHead>提示词</TableHead>
                    <TableHead className="w-24">需要图片</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config?.customPresets?.map((preset, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {preset.keywords.map((kw, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <p className="truncate text-sm" title={preset.prompt}>
                          {preset.prompt.substring(0, 80)}...
                        </p>
                      </TableCell>
                      <TableCell>
                        {preset.needImage ? <Badge variant="secondary">需要</Badge> : <Badge variant="outline">不需要</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {preset.uid && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingPreset({
                                  uid: preset.uid!,
                                  source: 'custom',
                                  keywords: preset.keywords.join(', '),
                                  prompt: preset.prompt,
                                  needImage: preset.needImage
                                })
                                setEditPresetOpen(true)
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeletePreset(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!config?.customPresets || config.customPresets.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        暂无自定义预设，点击上方按钮添加
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 基础设置 */}
        <TabsContent value="settings" className="space-y-4">
          {/* 启用开关 */}
          <Card>
            <CardHeader>
              <CardTitle>功能开关</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Label>启用绘图功能</Label>
                  <p className="text-sm text-muted-foreground">可使用 #文生图、#图生图、#文生视频、#图生视频 等命令</p>
                </div>
                <Switch
                  checked={config?.enabled ?? true}
                  onCheckedChange={(checked: boolean) => handleUpdateConfig({ enabled: checked })}
                />
              </div>
            </CardContent>
          </Card>

          {/* API 配置 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" />API配置</CardTitle>
                <CardDescription>支持多个API，会按顺序轮询和故障转移</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const apis = config?.apis || []
                  const newApis = [...apis, { baseUrl: '', apiKey: '', models: [] }]
                  setConfig(c => c ? { ...c, apis: newApis } : c)
                  handleUpdateConfig({ apis: newApis })
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> 添加API
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {(config?.apis || []).map((api, index) => (
                <div key={index} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">API {index + 1}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        const apis = [...(config?.apis || [])]
                        apis.splice(index, 1)
                        setConfig(c => c ? { ...c, apis } : c)
                        handleUpdateConfig({ apis })
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs">API地址</Label>
                      <Input
                        value={api.baseUrl || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const apis = [...(config?.apis || [])]
                          apis[index] = { ...apis[index], baseUrl: e.target.value }
                          setConfig(c => c ? { ...c, apis } : c)
                        }}
                        onBlur={() => config && handleUpdateConfig({ apis: config.apis })}
                        placeholder="https://api.openai.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">API密钥</Label>
                      <Input
                        type="password"
                        value={api.apiKey || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const apis = [...(config?.apis || [])]
                          apis[index] = { ...apis[index], apiKey: e.target.value }
                          setConfig(c => c ? { ...c, apis } : c)
                        }}
                        onBlur={() => config && handleUpdateConfig({ apis: config.apis })}
                        placeholder="sk-..."
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">可用模型 ({api.models?.length || 0})</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!api.baseUrl}
                        onClick={async () => {
                          if (!api.baseUrl) return
                          try {
                            const res = await channelsApi.fetchModels({
                              adapterType: 'openai',
                              baseUrl: api.baseUrl,
                              apiKey: api.apiKey
                            })
                            const models = (res as any)?.data?.models || []
                            const apis = [...(config?.apis || [])]
                            apis[index] = { ...apis[index], models }
                            setConfig(c => c ? { ...c, apis } : c)
                            handleUpdateConfig({ apis })
                            toast.success(`获取到 ${models.length} 个模型`)
                          } catch {
                            toast.error('获取模型失败')
                          }
                        }}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" /> 获取模型
                      </Button>
                    </div>
                    {api.models && api.models.length > 0 && (
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-2 bg-muted/50 rounded">
                        {api.models.slice(0, 30).map((m) => (
                          <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                        ))}
                        {api.models.length > 30 && (
                          <Badge variant="outline" className="text-xs">+{api.models.length - 30}</Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {(!config?.apis || config.apis.length === 0) && (
                <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
                  暂无API配置，点击上方按钮添加
                </div>
              )}
            </CardContent>
          </Card>

          {/* 模型选择 */}
          <Card>
            <CardHeader>
              <CardTitle>模型配置</CardTitle>
              <CardDescription>选择用于图片和视频生成的模型</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>图片模型</Label>
                  <Select 
                    value={config?.model || ''} 
                    onValueChange={(v: string) => handleUpdateConfig({ model: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from(new Set((config?.apis || []).flatMap(a => a.models || []))).map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                      {(config?.apis || []).flatMap(a => a.models || []).length === 0 && (
                        <SelectItem value="gemini-3-pro-image">gemini-3-pro-image</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>视频模型</Label>
                  <Select 
                    value={config?.videoModel || ''} 
                    onValueChange={(v: string) => handleUpdateConfig({ videoModel: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from(new Set((config?.apis || []).flatMap(a => a.models || []))).map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                      {(config?.apis || []).flatMap(a => a.models || []).length === 0 && (
                        <SelectItem value="gemini-3-pro-preview-video">gemini-3-pro-preview-video</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>超时时间 (毫秒)</Label>
                  <Input
                    type="number"
                    value={config?.timeout || 600000}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig(c => c ? { ...c, timeout: parseInt(e.target.value) || 600000 } : c)}
                    onBlur={() => config && handleUpdateConfig({ timeout: config.timeout })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>最大图片数</Label>
                  <Input
                    type="number"
                    value={config?.maxImages || 3}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig(c => c ? { ...c, maxImages: parseInt(e.target.value) || 3 } : c)}
                    onBlur={() => config && handleUpdateConfig({ maxImages: config.maxImages })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 添加来源弹窗 */}
      <Dialog open={addSourceOpen} onOpenChange={setAddSourceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加预设来源</DialogTitle>
            <DialogDescription>添加一个新的远程预设数据源</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={newSource.name}
                onChange={(e) => setNewSource(s => ({ ...s, name: e.target.value }))}
                placeholder="例如：云端预设"
              />
            </div>
            <div className="space-y-2">
              <Label>URL</Label>
              <Input
                value={newSource.url}
                onChange={(e) => setNewSource(s => ({ ...s, url: e.target.value }))}
                placeholder="https://example.com/presets.json"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={newSource.enabled}
                onCheckedChange={(checked) => setNewSource(s => ({ ...s, enabled: checked }))}
              />
              <Label>立即启用</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSourceOpen(false)}>取消</Button>
            <Button onClick={handleAddSource}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加预设弹窗 */}
      <Dialog open={addPresetOpen} onOpenChange={setAddPresetOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>添加自定义预设</DialogTitle>
            <DialogDescription>创建一个新的绘图预设模板</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>触发关键词</Label>
              <Input
                value={newPreset.keywords}
                onChange={(e) => setNewPreset(p => ({ ...p, keywords: e.target.value }))}
                placeholder="用逗号或空格分隔，例如：风景化, 风景"
              />
              <p className="text-xs text-muted-foreground">用户发送这些关键词会触发此预设</p>
            </div>
            <div className="space-y-2">
              <Label>提示词 (Prompt)</Label>
              <Textarea
                value={newPreset.prompt}
                onChange={(e) => setNewPreset(p => ({ ...p, prompt: e.target.value }))}
                placeholder="请输入发送给 AI 的提示词..."
                rows={6}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={newPreset.needImage}
                onCheckedChange={(checked) => setNewPreset(p => ({ ...p, needImage: checked }))}
              />
              <Label>需要用户提供图片</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPresetOpen(false)}>取消</Button>
            <Button onClick={handleAddPreset}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑预设弹窗 */}
      <Dialog open={editPresetOpen} onOpenChange={setEditPresetOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑预设</DialogTitle>
            <DialogDescription>
              修改{editingPreset?.source === 'custom' ? '自定义' : '云端'}预设的内容
            </DialogDescription>
          </DialogHeader>
          {editingPreset && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>触发关键词</Label>
                <Input
                  value={editingPreset.keywords}
                  onChange={(e) => setEditingPreset(p => p ? { ...p, keywords: e.target.value } : null)}
                  placeholder="用逗号或空格分隔，例如：风景化, 风景"
                />
                <p className="text-xs text-muted-foreground">用户发送这些关键词会触发此预设</p>
              </div>
              <div className="space-y-2">
                <Label>提示词 (Prompt)</Label>
                <Textarea
                  value={editingPreset.prompt}
                  onChange={(e) => setEditingPreset(p => p ? { ...p, prompt: e.target.value } : null)}
                  placeholder="请输入发送给 AI 的提示词..."
                  rows={8}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={editingPreset.needImage}
                  onCheckedChange={(checked) => setEditingPreset(p => p ? { ...p, needImage: checked } : null)}
                />
                <Label>需要用户提供图片</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditPresetOpen(false); setEditingPreset(null) }}>取消</Button>
            <Button onClick={handleSavePreset}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
