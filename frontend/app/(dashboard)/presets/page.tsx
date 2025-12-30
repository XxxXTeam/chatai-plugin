'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Palette, Copy, Star, Upload, FileDown, RefreshCw, User, MessageSquare, Sparkles, Heart, ThumbsDown, Tags, BookOpen, Library, Wand2 } from 'lucide-react'
import { PageHeader, PageContainer } from '@/components/layout/PageHeader'

interface PersonaConfig {
  name?: string
  personality?: string
  speakingStyle?: string
  background?: string
  traits?: string[]
  likes?: string[]
  dislikes?: string[]
  customFields?: Record<string, string>
}

interface Preset {
  id: string
  name: string
  description: string
  systemPrompt: string
  isDefault: boolean
  enableReasoning: boolean
  disableSystemPrompt?: boolean  // 禁用系统提示词，不发送system消息
  isBuiltin?: boolean
  isReadonly?: boolean
  category?: string
  modelParams?: {
    temperature?: number
    max_tokens?: number
  }
  persona?: PersonaConfig
  tools?: {
    enableBuiltinTools?: boolean
    disabledTools?: string[]
  }
  // 兼容旧字段
  temperature?: number
  maxTokens?: number
}

interface PresetCategory {
  name: string
  icon: string
  description: string
}

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [builtinPresets, setBuiltinPresets] = useState<Preset[]>([])
  const [categories, setCategories] = useState<Record<string, PresetCategory>>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('custom')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    isDefault: false,
    enableReasoning: false,
    disableSystemPrompt: false,  // 禁用系统提示词
    temperature: 0.7,
    maxTokens: 4096,
    // 人设字段
    personaName: '',
    personality: '',
    speakingStyle: '',
    background: '',
    traits: '',
    likes: '',
    dislikes: '',
  })

  const fetchPresets = async () => {
    try {
      const res = await presetsApi.list() as { data: Preset[] }
      // 只获取自定义预设（后端list接口返回全部，需要过滤）
      const all = res.data || []
      setPresets(all.filter(p => !p.isBuiltin))
    } catch (error) {
      toast.error('加载预设失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const fetchBuiltinPresets = async () => {
    try {
      const res = await presetsApi.listBuiltin() as { data: Preset[] }
      const builtins = res.data || []
      console.log('[Presets] 加载内置预设:', builtins.length)
      setBuiltinPresets(builtins)
    } catch (error) {
      console.error('加载内置预设失败:', error)
      // 如果单独API失败，尝试从list接口获取
      try {
        const res = await presetsApi.list() as { data: Preset[] }
        const all = res.data || []
        setBuiltinPresets(all.filter(p => p.isBuiltin))
      } catch (e) {
        console.error('备用加载也失败:', e)
      }
    }
  }

  const fetchCategories = async () => {
    try {
      const res = await presetsApi.getCategories() as { data: Record<string, PresetCategory> }
      setCategories(res.data || {})
    } catch (error) {
      console.error('加载分类失败:', error)
    }
  }

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchPresets(),
        fetchBuiltinPresets(),
        fetchCategories()
      ])
    }
    loadData()
  }, [])

  const handleUseBuiltin = async (builtinId: string) => {
    try {
      await presetsApi.createFromBuiltin(builtinId)
      toast.success('已从内置预设创建副本')
      fetchPresets()
      setActiveTab('custom')
    } catch (error) {
      toast.error('创建失败')
      console.error(error)
    }
  }

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      systemPrompt: '',
      isDefault: false,
      enableReasoning: false,
      disableSystemPrompt: false,
      temperature: 0.7,
      maxTokens: 4096,
      personaName: '',
      personality: '',
      speakingStyle: '',
      background: '',
      traits: '',
      likes: '',
      dislikes: '',
    })
    setEditingPreset(null)
  }

  const handleOpenDialog = (preset?: Preset) => {
    if (preset) {
      setEditingPreset(preset)
      const persona = preset.persona || {}
      setForm({
        name: preset.name,
        description: preset.description || '',
        systemPrompt: preset.systemPrompt || '',
        isDefault: preset.isDefault || false,
        enableReasoning: preset.enableReasoning || false,
        disableSystemPrompt: preset.disableSystemPrompt || false,
        temperature: preset.modelParams?.temperature ?? preset.temperature ?? 0.7,
        maxTokens: preset.modelParams?.max_tokens ?? preset.maxTokens ?? 4096,
        personaName: persona.name || '',
        personality: persona.personality || '',
        speakingStyle: persona.speakingStyle || '',
        background: persona.background || '',
        traits: (persona.traits || []).join(', '),
        likes: (persona.likes || []).join(', '),
        dislikes: (persona.dislikes || []).join(', '),
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
  }

  // 将 form 转换为后端数据结构
  const buildPresetData = () => {
    const parseList = (str: string) => str.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    
    return {
      name: form.name,
      description: form.description,
      systemPrompt: form.systemPrompt,
      isDefault: form.isDefault,
      enableReasoning: form.enableReasoning,
      disableSystemPrompt: form.disableSystemPrompt,
      modelParams: {
        temperature: form.temperature,
        max_tokens: form.maxTokens,
      },
      persona: {
        name: form.personaName.trim(),
        personality: form.personality.trim(),
        speakingStyle: form.speakingStyle.trim(),
        background: form.background.trim(),
        traits: parseList(form.traits),
        likes: parseList(form.likes),
        dislikes: parseList(form.dislikes),
      },
      // 兼容旧字段
      temperature: form.temperature,
      maxTokens: form.maxTokens,
    }
  }

  const handleSave = async () => {
    if (!form.name) {
      toast.error('请填写预设名称')
      return
    }

    setSaving(true)
    try {
      const presetData = buildPresetData()
      if (editingPreset) {
        await presetsApi.update(editingPreset.id, presetData)
        toast.success('预设已更新')
      } else {
        await presetsApi.create(presetData)
        toast.success('预设已创建')
      }

      setDialogOpen(false)
      resetForm()
      fetchPresets()
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此预设？')) return
    try {
      await presetsApi.delete(id)
      toast.success('预设已删除')
      fetchPresets()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const handleDuplicate = (preset: Preset) => {
    const persona = preset.persona || {}
    setForm({
      name: `${preset.name} (副本)`,
      description: preset.description || '',
      systemPrompt: preset.systemPrompt || '',
      isDefault: false,
      enableReasoning: preset.enableReasoning || false,
      disableSystemPrompt: preset.disableSystemPrompt || false,
      temperature: preset.modelParams?.temperature ?? preset.temperature ?? 0.7,
      maxTokens: preset.modelParams?.max_tokens ?? preset.maxTokens ?? 4096,
      personaName: persona.name || '',
      personality: persona.personality || '',
      speakingStyle: persona.speakingStyle || '',
      background: persona.background || '',
      traits: (persona.traits || []).join(', '),
      likes: (persona.likes || []).join(', '),
      dislikes: (persona.dislikes || []).join(', '),
    })
    setEditingPreset(null)
    setDialogOpen(true)
  }

  const handleSetDefault = async (id: string) => {
    try {
      await presetsApi.setDefault(id)
      toast.success('已设为默认预设')
      fetchPresets()
    } catch (error) {
      toast.error('设置失败')
      console.error(error)
    }
  }

  const exportPresets = () => {
    const data = JSON.stringify(presets.map(({ id, ...rest }) => rest), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `presets_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('导出成功')
  }

  const importPresets = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!Array.isArray(data)) {
          toast.error('无效的预设文件格式')
          return
        }
        let imported = 0
        for (const preset of data) {
          try {
            await presetsApi.create({ ...preset, isDefault: false })
            imported++
          } catch (err) {
            console.error('导入预设失败:', preset.name, err)
          }
        }
        toast.success(`成功导入 ${imported} 个预设`)
        fetchPresets()
      } catch (err) {
        toast.error('导入失败: ' + (err as Error).message)
      }
    }
    input.click()
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
    <PageContainer>
      <PageHeader
        title="预设管理"
        description="管理AI对话预设和人格配置"
        icon={Palette}
        actions={
          <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={importPresets}>
            <Upload className="mr-2 h-4 w-4" />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={exportPresets} disabled={presets.length === 0}>
            <FileDown className="mr-2 h-4 w-4" />
            导出
          </Button>
          <Button variant="outline" size="sm" onClick={fetchPresets}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加预设
              </Button>
            </DialogTrigger>
          <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>{editingPreset ? '编辑预设' : '添加预设'}</DialogTitle>
              <DialogDescription>配置AI对话预设</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">预设名称 *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="我的预设"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">描述</Label>
                  <Input
                    id="description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="预设描述..."
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="systemPrompt">系统提示词</Label>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="disableSystemPrompt" className="text-xs text-muted-foreground">禁用系统提示词</Label>
                      <Switch
                        id="disableSystemPrompt"
                        checked={form.disableSystemPrompt}
                        onCheckedChange={(checked) => setForm({ ...form, disableSystemPrompt: checked })}
                      />
                    </div>
                  </div>
                  {form.disableSystemPrompt ? (
                    <div className="p-4 bg-muted/50 rounded-md text-sm text-muted-foreground">
                      已禁用系统提示词，AI 将不会收到任何系统消息（包括预设、人设、全局提示词等）
                    </div>
                  ) : (
                    <>
                      <Textarea
                        id="systemPrompt"
                        value={form.systemPrompt}
                        onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                        placeholder="你是一个有帮助的AI助手..."
                        rows={8}
                      />
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p className="font-medium">支持占位符（运行时自动替换）：</p>
                        <p>
                          <code className="bg-muted px-1 rounded">{'{{bot_name}}'}</code> Bot名称 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{bot_id}}'}</code> Bot QQ号 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{user_name}}'}</code> 用户名称 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{user_id}}'}</code> 用户QQ号
                        </p>
                        <p>
                          <code className="bg-muted px-1 rounded">{'{{group_name}}'}</code> 群名称 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{group_id}}'}</code> 群号 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{date}}'}</code> 日期 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{time}}'}</code> 时间 | 
                          <code className="bg-muted px-1 rounded ml-1">{'{{weekday}}'}</code> 星期
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="temperature">温度 (0-2)</Label>
                    <Input
                      id="temperature"
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={form.temperature}
                      onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="maxTokens">最大Token数</Label>
                    <Input
                      id="maxTokens"
                      type="number"
                      min="1"
                      max="128000"
                      value={form.maxTokens}
                      onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                {/* 人设配置区 */}
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded-md bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                    </div>
                    <Label className="text-base font-semibold">角色人设</Label>
                    <Badge variant="outline" className="text-xs font-normal">可选</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4 ml-8">配置AI的角色人设，会自动整合到系统提示词中</p>
                  
                  <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                    {/* 基础信息 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="personaName" className="flex items-center gap-2 text-sm">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          角色名称
                        </Label>
                        <Input
                          id="personaName"
                          value={form.personaName}
                          onChange={(e) => setForm({ ...form, personaName: e.target.value })}
                          placeholder="如：小助手"
                          className="bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="speakingStyle" className="flex items-center gap-2 text-sm">
                          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          说话风格
                        </Label>
                        <Input
                          id="speakingStyle"
                          value={form.speakingStyle}
                          onChange={(e) => setForm({ ...form, speakingStyle: e.target.value })}
                          placeholder="如：活泼可爱、温柔礼貌"
                          className="bg-background"
                        />
                      </div>
                    </div>
                    
                    {/* 性格特点 */}
                    <div className="space-y-2">
                      <Label htmlFor="personality" className="flex items-center gap-2 text-sm">
                        <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                        性格特点
                      </Label>
                      <Input
                        id="personality"
                        value={form.personality}
                        onChange={(e) => setForm({ ...form, personality: e.target.value })}
                        placeholder="如：友善、乐于助人、幽默风趣"
                        className="bg-background"
                      />
                    </div>
                    
                    {/* 背景故事 */}
                    <div className="space-y-2">
                      <Label htmlFor="background" className="flex items-center gap-2 text-sm">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        背景故事
                      </Label>
                      <Textarea
                        id="background"
                        value={form.background}
                        onChange={(e) => setForm({ ...form, background: e.target.value })}
                        placeholder="角色的背景故事..."
                        rows={3}
                        className="bg-background resize-none"
                      />
                    </div>
                    
                    {/* 标签区 */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="traits" className="flex items-center gap-2 text-sm">
                          <Tags className="h-3.5 w-3.5 text-blue-500" />
                          性格标签
                        </Label>
                        <Input
                          id="traits"
                          value={form.traits}
                          onChange={(e) => setForm({ ...form, traits: e.target.value })}
                          placeholder="逗号分隔"
                          className="bg-background text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="likes" className="flex items-center gap-2 text-sm">
                          <Heart className="h-3.5 w-3.5 text-pink-500" />
                          喜好
                        </Label>
                        <Input
                          id="likes"
                          value={form.likes}
                          onChange={(e) => setForm({ ...form, likes: e.target.value })}
                          placeholder="逗号分隔"
                          className="bg-background text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dislikes" className="flex items-center gap-2 text-sm">
                          <ThumbsDown className="h-3.5 w-3.5 text-orange-500" />
                          讨厌
                        </Label>
                        <Input
                          id="dislikes"
                          value={form.dislikes}
                          onChange={(e) => setForm({ ...form, dislikes: e.target.value })}
                          placeholder="逗号分隔"
                          className="bg-background text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 其他设置 */}
                <div className="border-t pt-4 mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>启用深度思考</Label>
                      <p className="text-sm text-muted-foreground">使用思考模型进行推理</p>
                    </div>
                    <Switch
                      checked={form.enableReasoning}
                      onCheckedChange={(checked) => setForm({ ...form, enableReasoning: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>设为默认预设</Label>
                      <p className="text-sm text-muted-foreground">新对话将使用此预设</p>
                    </div>
                    <Switch
                      checked={form.isDefault}
                      onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })}
                    />
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
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="custom" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            我的预设 ({presets.length})
          </TabsTrigger>
          <TabsTrigger value="builtin" className="flex items-center gap-2">
            <Library className="h-4 w-4" />
            内置预设库 ({builtinPresets.length})
          </TabsTrigger>
        </TabsList>

        {/* 自定义预设 */}
        <TabsContent value="custom" className="mt-4">
      {presets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Palette className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无自定义预设</p>
            <p className="text-sm text-muted-foreground mt-2">可以从内置预设库中选择一个开始</p>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                创建预设
              </Button>
              <Button variant="outline" onClick={() => setActiveTab('builtin')}>
                <Library className="mr-2 h-4 w-4" />
                浏览内置库
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => (
            <Card key={preset.id} className={preset.isDefault ? 'border-primary' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {preset.name}
                    {preset.isDefault && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {preset.enableReasoning && (
                      <Badge variant="secondary">深度思考</Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="line-clamp-2">
                  {preset.description || '无描述'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground line-clamp-3 bg-muted/50 p-2 rounded">
                  {preset.systemPrompt?.substring(0, 150) || '无系统提示词'}{preset.systemPrompt?.length > 150 ? '...' : ''}
                </div>
                {preset.persona?.name && (
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-xs">
                      {preset.persona.name}
                    </Badge>
                    {preset.persona.personality && (
                      <Badge variant="outline" className="text-xs">
                        {preset.persona.personality.substring(0, 20)}
                      </Badge>
                    )}
                  </div>
                )}
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>温度: {preset.modelParams?.temperature ?? preset.temperature ?? 0.7}</span>
                  <span>•</span>
                  <span>Token: {preset.modelParams?.max_tokens ?? preset.maxTokens ?? 4096}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleOpenDialog(preset)}
                  >
                    编辑
                  </Button>
                  {!preset.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetDefault(preset.id)}
                      title="设为默认"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDuplicate(preset)}
                    title="复制"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(preset.id)}
                    disabled={preset.isDefault}
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </TabsContent>

        {/* 内置预设库 */}
        <TabsContent value="builtin" className="mt-4">
          {/* 分类筛选 */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              全部
            </Button>
            {Object.entries(categories).map(([key, cat]) => (
              <Button
                key={key}
                variant={selectedCategory === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(key)}
              >
                {cat.icon} {cat.name}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {builtinPresets
              .filter(p => !selectedCategory || p.category === selectedCategory)
              .map((preset) => (
              <Card key={preset.id} className="border-dashed">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      {preset.name}
                      <Badge variant="secondary" className="text-xs">内置</Badge>
                    </CardTitle>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {preset.description || '无描述'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground line-clamp-3 bg-muted/50 p-2 rounded">
                    {preset.systemPrompt?.substring(0, 120) || '无系统提示词'}
                    {(preset.systemPrompt?.length || 0) > 120 ? '...' : ''}
                  </div>
                  {preset.persona?.name && (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-xs">
                        {preset.persona.name}
                      </Badge>
                      {preset.persona.traits?.slice(0, 2).map((trait) => (
                        <Badge key={trait} variant="outline" className="text-xs">
                          {trait}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {preset.category && categories[preset.category] && (
                    <Badge variant="secondary" className="text-xs">
                      {categories[preset.category].icon} {categories[preset.category].name}
                    </Badge>
                  )}
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={() => handleUseBuiltin(preset.id)}
                  >
                    <Wand2 className="mr-2 h-4 w-4" />
                    使用此预设
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {builtinPresets.filter(p => !selectedCategory || p.category === selectedCategory).length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Library className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">此分类暂无内置预设</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
