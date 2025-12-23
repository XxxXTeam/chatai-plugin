'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
// import { Textarea } from '@/components/ui/textarea'
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
// import { ScrollArea } from '@/components/ui/scroll-area'
import { knowledgeApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  Plus, Trash2, Loader2, BookOpen, FileText, Search, 
  Link2, Unlink, RefreshCw, Upload, Maximize2
} from 'lucide-react'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState<KnowledgeDocument | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkingDocId, setLinkingDocId] = useState<string | null>(null)

  // 导入对话框
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importForm, setImportForm] = useState({
    name: '',
    format: 'openie' as 'openie' | 'raw',
    mergeMode: 'create' as 'create' | 'merge' | 'replace',
    tags: '',
    fileContent: null as string | null,
    fileName: ''
  })

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

  const handleOpenDialog = async (doc?: KnowledgeDocument) => {
    if (doc) {
      setEditingDoc(doc)
      // 先显示摘要，然后异步获取完整内容
      setForm({
        name: doc.name,
        content: doc.content || '',
        type: doc.type || 'text',
        tags: (doc.tags || []).join(', '),
      })
      setDialogOpen(true)
      
      // 如果内容被截断，获取完整内容
      if ((doc as { truncated?: boolean }).truncated || (doc as { contentLength?: number }).contentLength && (doc as { contentLength: number }).contentLength > 500) {
        try {
          const res = await knowledgeApi.get(doc.id) as { data?: { content?: string } }
          if (res?.data?.content) {
            setForm(prev => ({ ...prev, content: res.data.content }))
          }
        } catch (error) {
          console.error('获取完整内容失败:', error)
        }
      }
    } else {
      resetForm()
      setDialogOpen(true)
    }
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

  // 处理文件选择
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      let content: any

      if (file.name.endsWith('.json')) {
        content = JSON.parse(text)
        // 自动检测格式
        if (content.docs && Array.isArray(content.docs)) {
          setImportForm(prev => ({ 
            ...prev, 
            format: 'openie',
            fileContent: content,
            fileName: file.name,
            name: prev.name || file.name.replace(/\.[^.]+$/, '')
          }))
        } else {
          setImportForm(prev => ({ 
            ...prev, 
            format: 'raw',
            fileContent: content,
            fileName: file.name,
            name: prev.name || file.name.replace(/\.[^.]+$/, '')
          }))
        }
      } else {
        // 非 JSON 文件作为原始文本
        setImportForm(prev => ({ 
          ...prev, 
          format: 'raw',
          fileContent: text,
          fileName: file.name,
          name: prev.name || file.name.replace(/\.[^.]+$/, '')
        }))
      }
      toast.success(`已加载文件: ${file.name}`)
    } catch (error) {
      toast.error('文件解析失败，请确保是有效的 JSON 文件')
      console.error(error)
    }
  }

  // 导入知识库
  const handleImport = async () => {
    if (!importForm.fileContent) {
      toast.error('请先选择文件')
      return
    }

    setImporting(true)
    try {
      const res = await knowledgeApi.import({
        data: importForm.fileContent,
        format: importForm.format,
        name: importForm.name || importForm.fileName,
        tags: importForm.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        mergeMode: importForm.mergeMode
      }) as { data?: { stats?: { imported: number; entityCount: number; tripleCount: number } } }

      const stats = res?.data?.stats
      if (stats) {
        toast.success(`导入成功！共 ${stats.imported} 条记录，${stats.entityCount} 个实体，${stats.tripleCount} 个关系`)
      } else {
        toast.success('导入成功')
      }
      
      setImportDialogOpen(false)
      setImportForm({
        name: '',
        format: 'openie',
        mergeMode: 'create',
        tags: '',
        fileContent: null,
        fileName: ''
      })
      fetchDocuments()
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string }
      toast.error('导入失败: ' + (err?.response?.data?.message || err?.message || '未知错误'))
      console.error(error)
    } finally {
      setImporting(false)
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
          <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            导入
          </Button>
          <Button size="sm" onClick={() => router.push('/knowledge/new')}>
            <Plus className="mr-2 h-4 w-4" />
            添加文档
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <span className="hidden" />
            </DialogTrigger>
            <DialogContent className="max-w-[95vw] max-h-[98vh] w-[95vw] h-[95vh]">
              <DialogHeader>
                <DialogTitle>{editingDoc ? '编辑文档' : '添加文档'}</DialogTitle>
                <DialogDescription>创建或编辑知识库文档</DialogDescription>
              </DialogHeader>
              <div className="flex-1 overflow-auto pr-4" style={{ maxHeight: 'calc(95vh - 140px)' }}>
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
                  <div className="grid gap-2 flex-1">
                    <Label>文档内容 (支持 Markdown)</Label>
                    <MarkdownEditor
                      value={form.content}
                      onChange={(content) => setForm({ ...form, content })}
                      placeholder="输入知识库内容，支持 Markdown 格式..."
                      minHeight="calc(95vh - 280px)"
                    />
                  </div>
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
            <Button className="mt-4" onClick={() => router.push('/knowledge/new')}>
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
                  {doc.content?.substring(0, 200) || '(无内容)'}
                  {(doc.content?.length || 0) > 200 ? '...' : ''}
                </div>
                {(doc as { contentLength?: number }).contentLength && (doc as { contentLength: number }).contentLength > 0 && (
                  <div className="text-xs text-muted-foreground">
                    内容长度: {((doc as { contentLength: number }).contentLength / 1000).toFixed(1)}K 字符
                  </div>
                )}
                
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
                    onClick={() => router.push(`/knowledge/new?id=${doc.id}`)}
                  >
                    <Maximize2 className="mr-1 h-3 w-3" />
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

      {/* 导入对话框 */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="w-[95vw] max-w-lg">
          <DialogHeader>
            <DialogTitle>导入知识库</DialogTitle>
            <DialogDescription>
              支持导入 OpenIE 格式的知识图谱文件（包含实体和三元组）或普通文本/JSON 文件
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>选择文件</Label>
              <Input
                type="file"
                accept=".json,.txt,.md"
                onChange={handleFileSelect}
              />
              {importForm.fileName && (
                <p className="text-sm text-muted-foreground">
                  已选择: {importForm.fileName}
                  {importForm.format === 'openie' && (
                    <Badge variant="secondary" className="ml-2">OpenIE 格式</Badge>
                  )}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>文档名称</Label>
              <Input
                value={importForm.name}
                onChange={(e) => setImportForm({ ...importForm, name: e.target.value })}
                placeholder="导入的知识库名称"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>导入格式</Label>
                <Select
                  value={importForm.format}
                  onValueChange={(v: 'openie' | 'raw') => setImportForm({ ...importForm, format: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openie">OpenIE (知识图谱)</SelectItem>
                    <SelectItem value="raw">原始文本/JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>合并模式</Label>
                <Select
                  value={importForm.mergeMode}
                  onValueChange={(v: 'create' | 'merge' | 'replace') => setImportForm({ ...importForm, mergeMode: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">创建新文档</SelectItem>
                    <SelectItem value="merge">合并到同名文档</SelectItem>
                    <SelectItem value="replace">替换同名文档</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>标签（逗号分隔）</Label>
              <Input
                value={importForm.tags}
                onChange={(e) => setImportForm({ ...importForm, tags: e.target.value })}
                placeholder="角色, 设定"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleImport} disabled={importing || !importForm.fileContent}>
              {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
