'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Brain, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Users, ChevronDown, ChevronUp } from 'lucide-react'
import { memoryApi } from '@/lib/api'
import { toast } from 'sonner'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { cn } from '@/lib/utils'

interface Memory {
    id: number
    content: string
    timestamp?: number
    importance?: number
    score?: number
    source?: string
    metadata?: Record<string, unknown>
}

interface ApiResponse<T = unknown> {
    data?: T
    message?: string
}

// 记忆来源映射
const sourceLabels: Record<string, { label: string; color: string }> = {
    poll_summary: { label: '定时总结', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
    auto_extract: { label: '自动提取', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
    group_context: {
        label: '群聊分析',
        color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300'
    },
    manual: { label: '手动添加', color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
    ai_tool: { label: 'AI工具', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' }
}

// 移动端记忆卡片组件
function MemoryCard({ 
    memory, 
    onDelete 
}: { 
    memory: Memory
    onDelete: (id: number) => void 
}) {
    const [expanded, setExpanded] = useState(false)
    const source = (memory.source || (memory.metadata as Record<string, unknown>)?.source || 'manual') as string
    const sourceInfo = sourceLabels[source] || { label: source, color: 'bg-gray-100 text-gray-800' }

    return (
        <Card className="overflow-hidden">
            <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-mono text-muted-foreground">#{memory.id}</span>
                            <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', sourceInfo.color)}>
                                {sourceInfo.label}
                            </span>
                            {memory.score && (
                                <Badge variant="secondary" className="text-xs">
                                    {(memory.score * 100).toFixed(0)}%
                                </Badge>
                            )}
                        </div>
                        <p className={cn('text-sm', expanded ? '' : 'line-clamp-2')}>
                            {typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content)}
                        </p>
                        {memory.timestamp && (
                            <p className="text-xs text-muted-foreground mt-2">
                                {new Date(memory.timestamp).toLocaleString('zh-CN')}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setExpanded(!expanded)}
                        >
                            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => onDelete(memory.id)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

// 桌面端记忆表格行组件
function MemoryTableRow({ 
    memory, 
    onDelete 
}: { 
    memory: Memory
    onDelete: (id: number) => void 
}) {
    const source = (memory.source || (memory.metadata as Record<string, unknown>)?.source || 'manual') as string
    const sourceInfo = sourceLabels[source] || { label: source, color: 'bg-gray-100 text-gray-800' }

    return (
        <tr className="border-b hover:bg-muted/30 transition-colors">
            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{memory.id}</td>
            <td className="px-4 py-3 max-w-[400px]">
                <div
                    className="truncate text-sm"
                    title={typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content)}
                >
                    {typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content)}
                </div>
            </td>
            <td className="px-4 py-3">
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', sourceInfo.color)}>
                    {sourceInfo.label}
                </span>
            </td>
            <td className="px-4 py-3">
                {memory.score ? (
                    <Badge variant="secondary">{(memory.score * 100).toFixed(1)}%</Badge>
                ) : (
                    '-'
                )}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                {memory.timestamp ? new Date(memory.timestamp).toLocaleString('zh-CN') : '-'}
            </td>
            <td className="px-4 py-3">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onDelete(memory.id)}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </td>
        </tr>
    )
}

export default function MemoryPage() {
    const isMobile = useIsMobile()
    const [userId, setUserId] = useState('')
    const [userList, setUserList] = useState<string[]>([])
    const [memories, setMemories] = useState<Memory[]>([])
    const [loading, setLoading] = useState(false)
    const [stats, setStats] = useState({ totalUsers: 0, totalMemories: 0 })

    // 添加记忆弹窗
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [newMemory, setNewMemory] = useState({ content: '', metadata: '{}' })
    const [saving, setSaving] = useState(false)

    // 搜索
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<Memory[]>([])
    const [searching, setSearching] = useState(false)

    // 总结
    const [summarizing, setSummarizing] = useState(false)

    // 确认对话框
    const [clearUserDialogOpen, setClearUserDialogOpen] = useState(false)
    const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false)
    const [summarizeDialogOpen, setSummarizeDialogOpen] = useState(false)

    // 获取用户列表
    const fetchUserList = async () => {
        try {
            const res = (await memoryApi.getUsers()) as ApiResponse<string[]>
            const users = res?.data || []
            setUserList(users)
            setStats(prev => ({ ...prev, totalUsers: users.length }))
        } catch {
            console.error('获取用户列表失败')
        }
    }

    // 获取用户记忆
    const fetchMemories = async () => {
        if (!userId) {
            toast.warning('请选择或输入用户ID')
            return
        }

        setLoading(true)
        try {
            const res = (await memoryApi.get(userId)) as ApiResponse<Memory[]>
            const data = res?.data || []
            setMemories(data)
            setStats(prev => ({ ...prev, totalMemories: data.length }))
        } catch {
            toast.error('获取记忆失败')
            setMemories([])
        } finally {
            setLoading(false)
        }
    }

    // 添加记忆
    const handleAddMemory = async () => {
        if (!newMemory.content.trim()) {
            toast.warning('请输入记忆内容')
            return
        }

        setSaving(true)
        try {
            let metadata = {}
            try {
                metadata = JSON.parse(newMemory.metadata)
            } catch {
                // ignore
            }

            await memoryApi.create({
                userId,
                content: newMemory.content,
                metadata
            })
            toast.success('添加成功')
            setAddDialogOpen(false)
            setNewMemory({ content: '', metadata: '{}' })
            fetchMemories()
        } catch {
            toast.error('添加失败')
        } finally {
            setSaving(false)
        }
    }

    // 删除记忆
    const handleDeleteMemory = async (memoryId: number) => {
        try {
            await memoryApi.delete(userId, String(memoryId))
            toast.success('删除成功')
            fetchMemories()
        } catch {
            toast.error('删除失败')
        }
    }

    // 清空用户记忆
    const handleClearMemories = async () => {
        if (!userId) return
        try {
            await memoryApi.clearUser(userId)
            toast.success('清空成功')
            setMemories([])
        } catch {
            toast.error('清空失败')
        }
    }

    // 清空所有用户记忆
    const handleClearAllMemories = async () => {
        setLoading(true)
        try {
            const res = (await memoryApi.clearAll()) as ApiResponse<{ deletedCount: number }>
            const count = res?.data?.deletedCount || 0
            toast.success(`清空成功，共清空 ${count} 个用户的记忆`)
            setMemories([])
            await fetchUserList()
        } catch {
            toast.error('清空失败')
        } finally {
            setLoading(false)
        }
    }

    // 搜索记忆
    const handleSearch = async () => {
        if (!userId || !searchQuery.trim()) {
            toast.warning('请输入搜索关键词')
            return
        }

        setSearching(true)
        try {
            const res = (await memoryApi.search({ userId, query: searchQuery })) as ApiResponse<Memory[]>
            setSearchResults(res?.data || [])
        } catch {
            toast.error('搜索失败')
            setSearchResults([])
        } finally {
            setSearching(false)
        }
    }

    // 手动触发记忆总结（覆盖式）
    const handleSummarize = async () => {
        if (!userId) {
            toast.warning('请先选择用户')
            return
        }
        setSummarizing(true)
        try {
            const res = (await memoryApi.summarize(userId)) as ApiResponse<{
                success: boolean
                beforeCount: number
                afterCount: number
                error?: string
            }>
            const data = res?.data
            if (data?.success) {
                toast.success(`记忆整理完成\n整理前: ${data.beforeCount} 条\n整理后: ${data.afterCount} 条`)
                fetchMemories()
            } else {
                toast.error(data?.error || '总结失败')
            }
        } catch {
            toast.error('总结失败')
        } finally {
            setSummarizing(false)
        }
    }

    useEffect(() => {
        fetchUserList()
    }, [])

    const displayMemories = searchResults.length > 0 ? searchResults : memories

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* 统计卡片 - 移动端两列，桌面端三列 */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                <Card className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">用户数</p>
                            <p className="text-xl font-bold truncate">{stats.totalUsers}</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-green-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">当前用户记忆</p>
                            <p className="text-xl font-bold truncate">{memories.length}</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-3 sm:p-4 col-span-2 md:col-span-1">
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground">已选用户</p>
                            <p className="text-lg font-medium truncate">{userId || '-'}</p>
                        </div>
                    </div>
                </Card>
            </div>

            {/* 记忆管理 */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <CardTitle className="text-lg">记忆管理</CardTitle>
                            <CardDescription className="text-xs sm:text-sm">管理用户的长期记忆数据</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={fetchUserList} className="h-8">
                                <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />
                                <span className="hidden sm:inline">刷新</span>
                            </Button>
                            <Button 
                                variant="destructive" 
                                size="sm" 
                                onClick={() => setClearAllDialogOpen(true)}
                                className="h-8"
                            >
                                <Trash2 className="h-3.5 w-3.5 sm:mr-1.5" />
                                <span className="hidden sm:inline">清空所有</span>
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* 搜索栏 - 移动端堆叠布局 */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Select value={userId || '__none__'} onValueChange={v => setUserId(v === '__none__' ? '' : v)}>
                            <SelectTrigger className="w-full sm:w-[180px] h-9">
                                <SelectValue placeholder="选择用户" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">选择用户...</SelectItem>
                                {userList.map(u => (
                                    <SelectItem key={u} value={u}>
                                        {u}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            value={userId}
                            onChange={e => setUserId(e.target.value)}
                            placeholder="或直接输入用户ID"
                            className="h-9"
                        />
                        <Button onClick={fetchMemories} disabled={loading || !userId} className="h-9 shrink-0">
                            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                            <Search className="h-3.5 w-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline">查询</span>
                        </Button>
                    </div>

                    {/* 操作按钮 - 移动端网格布局 */}
                    {userId && (
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                            <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setAddDialogOpen(true)} 
                                disabled={!userId}
                                className="h-8"
                            >
                                <Plus className="h-3.5 w-3.5 mr-1.5" />
                                添加记忆
                            </Button>
                            {memories.length > 0 && (
                                <>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setSummarizeDialogOpen(true)}
                                        disabled={summarizing}
                                        className="h-8"
                                    >
                                        {summarizing ? (
                                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        ) : (
                                            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                                        )}
                                        总结整理
                                    </Button>
                                    <Button 
                                        variant="destructive" 
                                        size="sm"
                                        onClick={() => setClearUserDialogOpen(true)}
                                        className="h-8"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                        清空记忆
                                    </Button>
                                </>
                            )}
                        </div>
                    )}

                    {/* 搜索框 */}
                    {userId && memories.length > 0 && (
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="搜索记忆内容..."
                                className="h-9"
                                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                            />
                            <Button variant="outline" onClick={handleSearch} disabled={searching} className="h-9 shrink-0">
                                {searching && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                搜索
                            </Button>
                            {searchResults.length > 0 && (
                                <Button variant="ghost" onClick={() => setSearchResults([])} className="h-9 shrink-0">
                                    清除
                                </Button>
                            )}
                        </div>
                    )}

                    {/* 记忆列表 */}
                    {!userId ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>请选择或输入用户ID查询记忆</p>
                        </div>
                    ) : displayMemories.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>该用户暂无记忆</p>
                        </div>
                    ) : isMobile ? (
                        /* 移动端卡片列表 */
                        <div className="space-y-3">
                            {displayMemories.map(memory => (
                                <MemoryCard
                                    key={memory.id}
                                    memory={memory}
                                    onDelete={handleDeleteMemory}
                                />
                            ))}
                        </div>
                    ) : (
                        /* 桌面端表格 */
                        <div className="rounded-md border overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[60px]">ID</th>
                                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">内容</th>
                                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[90px]">来源</th>
                                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[70px]">相似度</th>
                                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[140px]">时间</th>
                                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[60px]">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayMemories.map(memory => (
                                        <MemoryTableRow
                                            key={memory.id}
                                            memory={memory}
                                            onDelete={handleDeleteMemory}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 添加记忆弹窗 */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>添加记忆</DialogTitle>
                        <DialogDescription>为用户 {userId} 添加新的记忆</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>记忆内容</Label>
                            <Textarea
                                value={newMemory.content}
                                onChange={e => setNewMemory({ ...newMemory, content: e.target.value })}
                                placeholder="输入要记住的内容..."
                                rows={4}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>元数据 (可选, JSON格式)</Label>
                            <Textarea
                                value={newMemory.metadata}
                                onChange={e => setNewMemory({ ...newMemory, metadata: e.target.value })}
                                placeholder='{"type": "fact", "importance": "high"}'
                                rows={2}
                                className="font-mono text-sm"
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="w-full sm:w-auto">
                            取消
                        </Button>
                        <Button onClick={handleAddMemory} disabled={saving} className="w-full sm:w-auto">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            添加
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 清空用户记忆确认对话框 */}
            <DeleteDialog
                open={clearUserDialogOpen}
                onOpenChange={setClearUserDialogOpen}
                title="清空用户记忆"
                description={`确定清空 ${userId} 的所有记忆？此操作不可撤销。`}
                onConfirm={handleClearMemories}
            />

            {/* 清空所有记忆确认对话框 */}
            <DeleteDialog
                open={clearAllDialogOpen}
                onOpenChange={setClearAllDialogOpen}
                title="清空所有记忆"
                description="确定清空所有用户的记忆？此操作不可恢复！"
                onConfirm={handleClearAllMemories}
            />

            {/* 总结整理确认对话框 */}
            <DeleteDialog
                open={summarizeDialogOpen}
                onOpenChange={setSummarizeDialogOpen}
                title="总结整理记忆"
                description={`确定要总结整理 ${userId} 的记忆？这将合并重复记忆并覆盖旧数据。`}
                onConfirm={handleSummarize}
                variant="default"
            />
        </div>
    )
}
