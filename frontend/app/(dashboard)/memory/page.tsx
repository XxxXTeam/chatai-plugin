'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
    Brain, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Users, 
    ChevronDown, ChevronRight, ChevronUp, Network, User, Heart, Calendar, Users2, 
    MessageSquare, Tag, Edit2, ArrowRight, Box, MapPin, Lightbulb 
} from 'lucide-react'
import { memoryApi, graphApi } from '@/lib/api'
import { toast } from 'sonner'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { cn } from '@/lib/utils'

// 记忆分类定义
const MemoryCategory = {
    PROFILE: 'profile',
    PREFERENCE: 'preference',
    EVENT: 'event',
    RELATION: 'relation',
    TOPIC: 'topic',
    CUSTOM: 'custom'
}

// 分类标签和图标
const CategoryConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    profile: { label: '基本信息', icon: <User className="h-4 w-4" />, color: 'text-blue-500' },
    preference: { label: '偏好习惯', icon: <Heart className="h-4 w-4" />, color: 'text-pink-500' },
    event: { label: '重要事件', icon: <Calendar className="h-4 w-4" />, color: 'text-green-500' },
    relation: { label: '人际关系', icon: <Users2 className="h-4 w-4" />, color: 'text-purple-500' },
    topic: { label: '话题兴趣', icon: <MessageSquare className="h-4 w-4" />, color: 'text-orange-500' },
    custom: { label: '其他', icon: <Tag className="h-4 w-4" />, color: 'text-gray-500' }
}

// 子类型定义
const SubTypeOptions: Record<string, Array<{ value: string; label: string }>> = {
    profile: [
        { value: 'name', label: '姓名' },
        { value: 'age', label: '年龄' },
        { value: 'gender', label: '性别' },
        { value: 'location', label: '所在地' },
        { value: 'occupation', label: '职业' },
        { value: 'education', label: '学历' },
        { value: 'contact', label: '联系方式' }
    ],
    preference: [
        { value: 'like', label: '喜欢' },
        { value: 'dislike', label: '讨厌' },
        { value: 'hobby', label: '爱好' },
        { value: 'habit', label: '习惯' },
        { value: 'food', label: '食物偏好' },
        { value: 'style', label: '风格偏好' }
    ],
    event: [
        { value: 'birthday', label: '生日' },
        { value: 'anniversary', label: '纪念日' },
        { value: 'plan', label: '计划' },
        { value: 'milestone', label: '里程碑' },
        { value: 'schedule', label: '日程' }
    ],
    relation: [
        { value: 'family', label: '家人' },
        { value: 'friend', label: '朋友' },
        { value: 'colleague', label: '同事' },
        { value: 'partner', label: '伴侣' },
        { value: 'pet', label: '宠物' }
    ],
    topic: [
        { value: 'interest', label: '兴趣' },
        { value: 'discussed', label: '讨论过' },
        { value: 'knowledge', label: '知识领域' }
    ],
    custom: []
}

// 记忆数据类型
interface Memory {
    id: number
    userId: string
    groupId?: string
    category: string
    subType?: string
    content: string
    confidence: number
    source: string
    metadata?: Record<string, unknown>
    createdAt: number
    updatedAt: number
    isActive: number
    subTypeLabel?: string
}

interface MemoryTreeCategory {
    label: string
    items: Memory[]
    count: number
}

interface MemoryTree {
    [category: string]: MemoryTreeCategory
}

interface UserInfo {
    userId: string
    count: number
    lastUpdate: number
    categories: string[]
}

interface ApiResponse<T = unknown> {
    data?: T
    message?: string
}

// 知识图谱类型
interface GraphEntity {
    id: number
    entityId: string
    entityType: string
    name: string
    scopeId: string
    properties?: Record<string, unknown>
    createdAt: number
    updatedAt: number
    version: number
}

interface GraphRelationship {
    id: number
    relationshipId: string
    fromEntityId: string
    toEntityId: string
    relationType: string
    scopeId: string
    properties?: Record<string, unknown>
}

interface GraphStats {
    entityCount: number
    relationshipCount: number
    typeStats: Record<string, number>
}

// 实体类型图标映射
const entityTypeIcons: Record<string, React.ReactNode> = {
    person: <User className="h-4 w-4" />,
    place: <MapPin className="h-4 w-4" />,
    concept: <Lightbulb className="h-4 w-4" />,
    event: <Calendar className="h-4 w-4" />,
    thing: <Box className="h-4 w-4" />
}

const entityTypeLabels: Record<string, string> = {
    person: '人物',
    place: '地点',
    concept: '概念',
    event: '事件',
    thing: '物品'
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
                            {memory.confidence && (
                                <Badge variant="secondary" className="text-xs">
                                    {(memory.confidence * 100).toFixed(0)}%
                                </Badge>
                            )}
                        </div>
                        <p className={cn('text-sm', expanded ? '' : 'line-clamp-2')}>
                            {typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content)}
                        </p>
                        {memory.updatedAt && (
                            <p className="text-xs text-muted-foreground mt-2">
                                {new Date(memory.updatedAt).toLocaleString('zh-CN')}
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
                {memory.confidence ? (
                    <Badge variant="secondary">{(memory.confidence * 100).toFixed(1)}%</Badge>
                ) : (
                    '-'
                )}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                {memory.updatedAt ? new Date(memory.updatedAt).toLocaleString('zh-CN') : '-'}
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
    const [userList, setUserList] = useState<UserInfo[]>([])
    const [memories, setMemories] = useState<Memory[]>([])
    const [memoryTree, setMemoryTree] = useState<MemoryTree | null>(null)
    const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree')
    const [loading, setLoading] = useState(false)
    const [stats, setStats] = useState({ totalUsers: 0, totalMemories: 0 })
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['profile', 'preference', 'event']))

    // 添加记忆弹窗
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [newMemory, setNewMemory] = useState({ 
        content: '', 
        category: 'custom' as string,
        subType: '' as string
    })
    const [saving, setSaving] = useState(false)

    // 编辑记忆
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editingMemory, setEditingMemory] = useState<Memory | null>(null)

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

    // 知识图谱状态
    const [activeTab, setActiveTab] = useState('memory')
    const [graphScopes, setGraphScopes] = useState<string[]>([])
    const [selectedScope, setSelectedScope] = useState('')
    const [graphEntities, setGraphEntities] = useState<GraphEntity[]>([])
    const [graphRelationships, setGraphRelationships] = useState<GraphRelationship[]>([])
    const [graphStats, setGraphStats] = useState<GraphStats>({ entityCount: 0, relationshipCount: 0, typeStats: {} })
    const [graphLoading, setGraphLoading] = useState(false)
    const [selectedEntity, setSelectedEntity] = useState<GraphEntity | null>(null)

    // 获取用户列表
    const fetchUserList = async () => {
        try {
            const res = (await memoryApi.getUsers()) as ApiResponse<UserInfo[]>
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
            if (viewMode === 'tree') {
                const res = (await memoryApi.getTree(userId)) as ApiResponse<MemoryTree>
                setMemoryTree(res?.data || null)
                // 计算总数
                const total = Object.values(res?.data || {}).reduce((sum, cat) => sum + cat.count, 0)
                setStats(prev => ({ ...prev, totalMemories: total }))
            } else {
                const res = (await memoryApi.get(userId)) as ApiResponse<Memory[]>
                const data = res?.data || []
                setMemories(data)
                setStats(prev => ({ ...prev, totalMemories: data.length }))
            }
        } catch {
            toast.error('获取记忆失败')
            setMemories([])
            setMemoryTree(null)
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
        if (!userId) {
            toast.warning('请先选择用户')
            return
        }

        setSaving(true)
        try {
            await memoryApi.create({
                userId,
                content: newMemory.content,
                category: newMemory.category,
                subType: newMemory.subType || undefined
            })
            toast.success('添加成功')
            setAddDialogOpen(false)
            setNewMemory({ content: '', category: 'custom', subType: '' })
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
            await memoryApi.delete(memoryId)
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

    // 获取知识图谱作用域列表
    const fetchGraphScopes = async () => {
        try {
            const res = (await graphApi.getScopes()) as ApiResponse<string[]>
            setGraphScopes(res?.data || [])
        } catch {
            console.error('获取图谱作用域失败')
        }
    }

    // 获取图谱统计
    const fetchGraphStats = async (scopeId?: string) => {
        try {
            const res = (await graphApi.getStats(scopeId)) as ApiResponse<GraphStats>
            setGraphStats(res?.data || { entityCount: 0, relationshipCount: 0, typeStats: {} })
        } catch {
            console.error('获取图谱统计失败')
        }
    }

    // 获取图谱实体
    const fetchGraphEntities = async () => {
        if (!selectedScope) return
        setGraphLoading(true)
        try {
            const res = (await graphApi.getEntities(selectedScope, { limit: 100 })) as ApiResponse<GraphEntity[]>
            setGraphEntities(res?.data || [])
        } catch {
            toast.error('获取实体失败')
            setGraphEntities([])
        } finally {
            setGraphLoading(false)
        }
    }

    // 获取实体关系
    const fetchEntityRelationships = async (entityId: string) => {
        try {
            const res = (await graphApi.getEntityRelationships(entityId)) as ApiResponse<GraphRelationship[]>
            setGraphRelationships(res?.data || [])
        } catch {
            setGraphRelationships([])
        }
    }

    // 删除实体
    const handleDeleteEntity = async (entityId: string) => {
        try {
            await graphApi.deleteEntity(entityId)
            toast.success('删除成功')
            fetchGraphEntities()
            fetchGraphStats(selectedScope)
            setSelectedEntity(null)
        } catch {
            toast.error('删除失败')
        }
    }

    useEffect(() => {
        fetchUserList()
        fetchGraphScopes()
        fetchGraphStats()
    }, [])

    // 切换作用域时加载数据
    useEffect(() => {
        if (selectedScope) {
            fetchGraphEntities()
            fetchGraphStats(selectedScope)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedScope])

    const displayMemories = searchResults.length > 0 ? searchResults : memories

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* 统计卡片 - 移动端两列，桌面端四列 */}
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <Card className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">记忆用户</p>
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
                <Card className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Network className="h-5 w-5 text-purple-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">图谱实体</p>
                            <p className="text-xl font-bold truncate">{graphStats.entityCount}</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <ArrowRight className="h-5 w-5 text-orange-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">图谱关系</p>
                            <p className="text-xl font-bold truncate">{graphStats.relationshipCount}</p>
                        </div>
                    </div>
                </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 max-w-md">
                    <TabsTrigger value="memory">
                        <Brain className="h-4 w-4 mr-2" />
                        记忆管理
                    </TabsTrigger>
                    <TabsTrigger value="graph">
                        <Network className="h-4 w-4 mr-2" />
                        知识图谱
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="memory" className="space-y-4">
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
                                    <SelectItem key={u.userId} value={u.userId}>
                                        {u.userId} ({u.count})
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
                        <Button 
                            variant="outline"
                            onClick={() => setAddDialogOpen(true)} 
                            className="h-9 shrink-0"
                        >
                            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline">添加记忆</span>
                        </Button>
                    </div>

                    {/* 操作按钮 - 移动端网格布局 */}
                    {userId && memories.length > 0 && (
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
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
                </TabsContent>

                <TabsContent value="graph" className="space-y-4">
                    {/* 知识图谱 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                    <CardTitle className="text-lg">知识图谱</CardTitle>
                                    <CardDescription className="text-xs sm:text-sm">查看和管理用户知识图谱实体和关系</CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => { fetchGraphScopes(); fetchGraphStats() }} className="h-8">
                                        <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />
                                        <span className="hidden sm:inline">刷新</span>
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* 作用域选择 */}
                            <div className="flex flex-col sm:flex-row gap-2">
                                <Select value={selectedScope || '__none__'} onValueChange={v => setSelectedScope(v === '__none__' ? '' : v)}>
                                    <SelectTrigger className="w-full sm:w-[250px] h-9">
                                        <SelectValue placeholder="选择作用域" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">选择作用域...</SelectItem>
                                        {graphScopes.map(scope => (
                                            <SelectItem key={scope} value={scope}>
                                                {scope}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button onClick={fetchGraphEntities} disabled={graphLoading || !selectedScope} className="h-9 shrink-0">
                                    {graphLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                    <Search className="h-3.5 w-3.5 sm:mr-1.5" />
                                    <span className="hidden sm:inline">查询</span>
                                </Button>
                            </div>

                            {/* 类型统计 */}
                            {Object.keys(graphStats.typeStats).length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(graphStats.typeStats).map(([type, count]) => (
                                        <Badge key={type} variant="secondary" className="flex items-center gap-1">
                                            {entityTypeIcons[type] || <Box className="h-3 w-3" />}
                                            {entityTypeLabels[type] || type}: {count}
                                        </Badge>
                                    ))}
                                </div>
                            )}

                            {/* 实体列表 */}
                            {!selectedScope ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>请选择作用域查看知识图谱</p>
                                </div>
                            ) : graphEntities.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>该作用域暂无实体</p>
                                </div>
                            ) : (
                                <div className="rounded-md border overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[60px]">类型</th>
                                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">名称</th>
                                                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[200px]">属性</th>
                                                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[140px]">更新时间</th>
                                                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-[60px]">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {graphEntities.map(entity => (
                                                <tr key={entity.entityId} className="border-b hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => { setSelectedEntity(entity); fetchEntityRelationships(entity.entityId) }}>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            {entityTypeIcons[entity.entityType] || <Box className="h-4 w-4" />}
                                                            <span className="text-xs text-muted-foreground">{entityTypeLabels[entity.entityType] || entity.entityType}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 font-medium">{entity.name}</td>
                                                    <td className="px-4 py-3 text-xs text-muted-foreground">
                                                        {entity.properties ? Object.entries(entity.properties).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ') : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                                        {entity.updatedAt ? new Date(entity.updatedAt).toLocaleString('zh-CN') : '-'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteEntity(entity.entityId) }}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* 实体详情和关系 */}
                            {selectedEntity && (
                                <Card className="mt-4">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-base flex items-center gap-2">
                                                {entityTypeIcons[selectedEntity.entityType]}
                                                {selectedEntity.name}
                                            </CardTitle>
                                            <Button variant="ghost" size="sm" onClick={() => setSelectedEntity(null)}>关闭</Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3">
                                            {selectedEntity.properties && Object.keys(selectedEntity.properties).length > 0 && (
                                                <div>
                                                    <p className="text-sm font-medium mb-1">属性</p>
                                                    <div className="text-sm text-muted-foreground">
                                                        {Object.entries(selectedEntity.properties).map(([k, v]) => (
                                                            <div key={k}>{k}: {String(v)}</div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {graphRelationships.length > 0 && (
                                                <div>
                                                    <p className="text-sm font-medium mb-1">关系 ({graphRelationships.length})</p>
                                                    <div className="space-y-1">
                                                        {graphRelationships.map(rel => (
                                                            <div key={rel.relationshipId} className="text-sm text-muted-foreground flex items-center gap-1">
                                                                <ArrowRight className="h-3 w-3" />
                                                                <span className="font-medium">{rel.relationType}</span>
                                                                <span className="text-xs">({rel.fromEntityId === selectedEntity.entityId ? '到' : '来自'} {rel.fromEntityId === selectedEntity.entityId ? rel.toEntityId : rel.fromEntityId})</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* 添加记忆弹窗 */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>添加记忆</DialogTitle>
                        <DialogDescription>为指定用户添加新的结构化记忆</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>用户ID <span className="text-destructive">*</span></Label>
                            <Input
                                value={userId}
                                onChange={e => setUserId(e.target.value)}
                                placeholder="输入用户ID"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>分类 <span className="text-destructive">*</span></Label>
                            <Select value={newMemory.category} onValueChange={v => setNewMemory({ ...newMemory, category: v, subType: '' })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="选择分类" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(CategoryConfig).map(([key, config]) => (
                                        <SelectItem key={key} value={key}>
                                            <span className="flex items-center gap-2">
                                                <span className={config.color}>{config.icon}</span>
                                                {config.label}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {SubTypeOptions[newMemory.category]?.length > 0 && (
                            <div className="space-y-2">
                                <Label>子类型 (可选)</Label>
                                <Select value={newMemory.subType || '__none__'} onValueChange={v => setNewMemory({ ...newMemory, subType: v === '__none__' ? '' : v })}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="选择子类型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">不指定</SelectItem>
                                        {SubTypeOptions[newMemory.category].map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>记忆内容 <span className="text-destructive">*</span></Label>
                            <Textarea
                                value={newMemory.content}
                                onChange={e => setNewMemory({ ...newMemory, content: e.target.value })}
                                placeholder="输入要记住的内容..."
                                rows={4}
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="w-full sm:w-auto">
                            取消
                        </Button>
                        <Button onClick={handleAddMemory} disabled={saving || !userId || !newMemory.content.trim()} className="w-full sm:w-auto">
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
