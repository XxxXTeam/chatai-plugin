'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { knowledgeApi } from '@/lib/api'
import { toast } from 'sonner'
import { ArrowLeft, Save, Loader2, FileText, Clock } from 'lucide-react'

interface KnowledgeDocument {
    id: string
    name: string
    content: string
    type: 'text' | 'markdown' | 'json'
    tags: string[]
    createdAt: number
    updatedAt: number
    presetIds: string[]
}

interface Props {
    id: string
}

export function KnowledgeEditor({ id: propsId }: Props) {
    const router = useRouter()
    const searchParams = useSearchParams()

    // 优先使用查询参数中的 ID（用于编辑现有文档）
    const queryId = searchParams.get('id')
    const id = queryId || propsId
    const isNew = id === 'new' && !queryId

    const [loading, setLoading] = useState(!isNew)
    const [saving, setSaving] = useState(false)
    const [doc, setDoc] = useState<KnowledgeDocument | null>(null)
    const [form, setForm] = useState({
        name: '',
        content: '',
        type: 'markdown' as 'text' | 'markdown' | 'json',
        tags: ''
    })

    useEffect(() => {
        if (!isNew) {
            fetchDocument()
        }
    }, [id, isNew])

    const fetchDocument = async () => {
        try {
            setLoading(true)
            const res = (await knowledgeApi.get(id)) as { data?: KnowledgeDocument }
            if (res?.data) {
                setDoc(res.data)
                setForm({
                    name: res.data.name || '',
                    content: res.data.content || '',
                    type: res.data.type || 'markdown',
                    tags: (res.data.tags || []).join(', ')
                })
            }
        } catch (error) {
            console.error('Failed to fetch document:', error)
            toast.error('加载文档失败')
            router.push('/knowledge')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        if (!form.name.trim()) {
            toast.error('请填写文档名称')
            return
        }

        setSaving(true)
        try {
            const docData = {
                name: form.name.trim(),
                content: form.content,
                type: form.type,
                tags: form.tags
                    .split(/[,，]/)
                    .map(s => s.trim())
                    .filter(Boolean)
            }

            if (isNew) {
                await knowledgeApi.create(docData)
                toast.success('文档已创建')
            } else {
                await knowledgeApi.update(id, docData)
                toast.success('文档已保存')
            }

            router.push('/knowledge')
        } catch (error) {
            console.error('Failed to save document:', error)
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    if (loading) {
        return (
            <div className="space-y-4 p-4">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-[calc(100vh-200px)] w-full" />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            {/* 顶部工具栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={() => router.push('/knowledge')}>
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        返回
                    </Button>
                    <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <h1 className="text-xl font-semibold">{isNew ? '创建文档' : '编辑文档'}</h1>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {doc && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>更新于 {formatDate(doc.updatedAt)}</span>
                        </div>
                    )}
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        保存
                    </Button>
                </div>
            </div>

            {/* 主编辑区 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左侧元数据面板 */}
                <div className="w-72 border-r p-4 space-y-4 overflow-y-auto bg-muted/20">
                    <div className="space-y-2">
                        <Label htmlFor="name">文档名称 *</Label>
                        <Input
                            id="name"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder="输入文档名称"
                        />
                    </div>

                    <div className="space-y-2">
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

                    <div className="space-y-2">
                        <Label htmlFor="tags">标签</Label>
                        <Input
                            id="tags"
                            value={form.tags}
                            onChange={e => setForm({ ...form, tags: e.target.value })}
                            placeholder="逗号分隔多个标签"
                        />
                        {form.tags && (
                            <div className="flex flex-wrap gap-1 mt-2">
                                {form.tags
                                    .split(/[,，]/)
                                    .filter(Boolean)
                                    .map((tag, i) => (
                                        <Badge key={i} variant="secondary" className="text-xs">
                                            {tag.trim()}
                                        </Badge>
                                    ))}
                            </div>
                        )}
                    </div>

                    {doc && (
                        <Card className="mt-4">
                            <CardHeader className="py-3">
                                <CardTitle className="text-sm">文档信息</CardTitle>
                            </CardHeader>
                            <CardContent className="py-2 text-sm space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">ID</span>
                                    <span className="font-mono text-xs">{doc.id.slice(0, 8)}...</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">字符数</span>
                                    <span>{form.content.length.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">行数</span>
                                    <span>{form.content.split('\n').length}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">关联预设</span>
                                    <span>{doc.presetIds?.length || 0} 个</span>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* 右侧编辑器 */}
                <div className="flex-1 p-4 overflow-hidden">
                    <MarkdownEditor
                        value={form.content}
                        onChange={content => setForm({ ...form, content })}
                        placeholder="输入知识库内容，支持 Markdown 格式..."
                        minHeight="calc(100vh - 180px)"
                        className="h-full"
                    />
                </div>
            </div>
        </div>
    )
}
