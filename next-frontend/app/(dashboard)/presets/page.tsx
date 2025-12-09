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
import { presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Palette, Copy, Star } from 'lucide-react'

interface Preset {
  id: string
  name: string
  description: string
  systemPrompt: string
  isDefault: boolean
  enableReasoning: boolean
  temperature: number
  maxTokens: number
}

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    isDefault: false,
    enableReasoning: false,
    temperature: 0.7,
    maxTokens: 4096,
  })

  const fetchPresets = async () => {
    try {
      const res = await presetsApi.list() as { data: Preset[] }
      setPresets(res.data || [])
    } catch (error) {
      toast.error('加载预设失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPresets()
  }, [])

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      systemPrompt: '',
      isDefault: false,
      enableReasoning: false,
      temperature: 0.7,
      maxTokens: 4096,
    })
    setEditingPreset(null)
  }

  const handleOpenDialog = (preset?: Preset) => {
    if (preset) {
      setEditingPreset(preset)
      setForm({
        name: preset.name,
        description: preset.description || '',
        systemPrompt: preset.systemPrompt || '',
        isDefault: preset.isDefault || false,
        enableReasoning: preset.enableReasoning || false,
        temperature: preset.temperature || 0.7,
        maxTokens: preset.maxTokens || 4096,
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name) {
      toast.error('请填写预设名称')
      return
    }

    setSaving(true)
    try {
      if (editingPreset) {
        await presetsApi.update(editingPreset.id, form)
        toast.success('预设已更新')
      } else {
        await presetsApi.create(form)
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
    setForm({
      name: `${preset.name} (副本)`,
      description: preset.description || '',
      systemPrompt: preset.systemPrompt || '',
      isDefault: false,
      enableReasoning: preset.enableReasoning || false,
      temperature: preset.temperature || 0.7,
      maxTokens: preset.maxTokens || 4096,
    })
    setEditingPreset(null)
    setDialogOpen(true)
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
        <h2 className="text-2xl font-bold">预设管理</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              添加预设
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh]">
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
                  <Label htmlFor="systemPrompt">系统提示词</Label>
                  <Textarea
                    id="systemPrompt"
                    value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="你是一个有帮助的AI助手..."
                    rows={8}
                  />
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

      {presets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Palette className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无预设配置</p>
            <Button className="mt-4" onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              创建第一个预设
            </Button>
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
                  {preset.systemPrompt?.substring(0, 150) || '无系统提示词'}...
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>温度: {preset.temperature}</span>
                  <span>•</span>
                  <span>Token: {preset.maxTokens}</span>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDuplicate(preset)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(preset.id)}
                    disabled={preset.id === 'default'}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
