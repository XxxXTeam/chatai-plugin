'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { knowledgeApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  Plus, Trash2, Loader2, BookOpen, FileText, Search, 
  Link2, Unlink, RefreshCw, Upload, FileDown, Tags, Edit
} from 'lucide-react'

interface KnowledgeDocument {
  id: string
  name: string
  content: string
  type: 'text' | 'markdown' | 'json'
  tags: string[]
  createdAt: number
  updatedAt: number
  presetIds: string[]
  contentLength?: number
}

interface Preset {
  id: string
  name: string
  isBuiltin?: boolean
}

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState<KnowledgeDocument | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkingDocId, setLinkingDocId] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    content: '',
    type: 'text' as 'text' | 'markdown' | 'json',
    tags: '',
  })

  const fetchDocuments = async () => {
    try {
      const res = await knowledgeApi.list() as { data: KnowledgeDocument[] }
      setDocuments(res.data || [])
    } catch (error) {
      toast.error('加载知识库失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const fetchPresets = async () => {
    try {
      const res = await presetsApi.list() as { data: Preset[] }
      setPresets(res.data || [])
    } catch (error) {
      console.error('加载预设失败:', error)
    }
  }

  useEffect(() => {
    fetchDocuments()
    fetchPresets()
  }, [])

  const resetForm = () => {
    setForm({
      name: '',
      content: '',
      type: 'text',
      tags: '',
    })
    setEditingDoc(null)
  }

  const handleOpenDialog = (doc?: KnowledgeDocument) => {
    if (doc) {
      setEditingDoc(doc)
      setForm({
        name: doc.name,
        content: doc.content || '',
        type: doc.type || 'text',
        tags: (doc.tags || []).join(', '),
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name) {
      toast.error('请填写文档名称')
      return
    }

    setSaving(true)
    try {
      const docData = {
        name: form.name,
        content: form.content,
        type: form.type,
        tags: form.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      }

      if (editingDoc) {
        await knowledgeApi.update(editingDoc.id, docData)
        toast.success('文档已更新')
      } else {
        await knowledgeApi.create(docData)
        toast.success('文档已创建')
      }

      setDialogOpen(false)
      resetForm()
      fetchDocuments()
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此文档？')) return
    try {
      await knowledgeApi.delete(id)
      toast.success('文档已删除')
      fetchDocuments()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const handleLinkPreset = async (docId: string, presetId: string) => {
    try {
      await knowledgeApi.linkToPreset(docId, presetId)
      toast.success('已关联到预设')
      fetchDocuments()
      setLinkDialogOpen(false)
    } catch (error) {
      toast.error('关联失败')
      console.error(error)
    }
  }

  const handleUnlinkPreset = async (docId: string, presetId: string) => {
    try {
      await knowledgeApi.unlinkFromPreset(docId, presetId)
      toast.success('已取消关联')
      fetchDocuments()
    } catch (error) {
      toast.error('取消关联失败')
      console.error(error)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchDocuments()
      return
    }
    try {
      const res = await knowledgeApi.search(searchQuery) as { data: { doc: KnowledgeDocument }[] }
      setDocuments((res.data || []).map(r => r.doc))
    } catch (error) {
      toast.error('搜索失败')
      console.error(error)
    }
  }

  const getPresetName = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId)
    return preset?.name || presetId
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'markdown':
        return <Badge variant="secondary">MD</Badge>
      case 'json':
        return <Badge variant="outline">JSON</Badge>
      default:
        return <Badge variant="outline">TXT</Badge>
    }
  }

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '未知'
    return new Date(timestamp).toLocaleDateString('zh-CN')
  }

  const filteredDocuments = searchQuery
    ? documents
    : documents

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
        <h2 className="text-2xl font-bold">知识库管理</h2>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索知识库..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-8 w-48"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setSearchQuery(''); fetchDocuments() }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => handleOpenDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                添加文档
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>{editingDoc ? '编辑文档' : '添加文档'}</DialogTitle>
                <DialogDescription>创建或编辑知识库文档</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="name">文档名称 *</Label>
                      <Input
                        id="name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="角色设定参考"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="type">文档类型</Label>
                      <Select
                        value={form.type}
                        onValueChange={(value: 'text' | 'markdown' | 'json') => setForm({ ...form, type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">纯文本</SelectItem>
                          <SelectItem value="markdown">Markdown</SelectItem>
                          <SelectItem value="json">JSON</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="tags">标签（逗号分隔）</Label>
                    <Input
                      id="tags"
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder="角色, 设定, 参考"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="content">文档内容</Label>
                    <Textarea
                      id="content"
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder="输入知识库内容..."
                      rows={12}
                      className="font-mono text-sm"
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

      {/* 关联预设对话框 */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联到预设</DialogTitle>
            <DialogDescription>选择要关联的预设</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {presets.filter(p => !p.isBuiltin).map((preset) => (
              <div
                key={preset.id}
                className="flex items-center justify-between p-2 rounded border hover:bg-muted/50 cursor-pointer"
                onClick={() => linkingDocId && handleLinkPreset(linkingDocId, preset.id)}
              >
                <span>{preset.name}</span>
                <Link2 className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
            {presets.filter(p => !p.isBuiltin).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                暂无可关联的自定义预设
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无知识库文档</p>
            <p className="text-sm text-muted-foreground mt-2">
              知识库文档可以关联到预设，为AI提供额外的参考信息
            </p>
            <Button className="mt-4" onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              创建第一个文档
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDocuments.map((doc) => (
            <Card key={doc.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {doc.name}
                  </CardTitle>
                  {getTypeIcon(doc.type)}
                </div>
                <CardDescription>
                  更新于 {formatDate(doc.updatedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground line-clamp-3 bg-muted/50 p-2 rounded font-mono">
                  {doc.content?.substring(0, 150) || '(无内容)'}
                  {(doc.content?.length || 0) > 150 ? '...' : ''}
                </div>
                
                {/* 标签 */}
                {doc.tags && doc.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {doc.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {doc.tags.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{doc.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
                
                {/* 关联的预设 */}
                {doc.presetIds && doc.presetIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-muted-foreground mr-1">关联:</span>
                    {doc.presetIds.slice(0, 2).map((presetId) => (
                      <Badge key={presetId} variant="outline" className="text-xs flex items-center gap-1">
                        {getPresetName(presetId)}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleUnlinkPreset(doc.id, presetId)
                          }}
                          className="hover:text-destructive"
                        >
                          <Unlink className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {doc.presetIds.length > 2 && (
                      <Badge variant="outline" className="text-xs">
                        +{doc.presetIds.length - 2}
                      </Badge>
                    )}
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleOpenDialog(doc)}
                  >
                    <Edit className="mr-1 h-3 w-3" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLinkingDocId(doc.id)
                      setLinkDialogOpen(true)
                    }}
                    title="关联预设"
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(doc.id)}
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
    </div>
  )
}
