'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { scopeApi, presetsApi } from '@/lib/api'
import { toast } from 'sonner'
import {
    Plus,
    Trash2,
    Loader2,
    Users,
    RefreshCw,
    Settings,
    Search,
    Power,
    PowerOff,
    MoreHorizontal,
    MessageSquare,
    Zap,
    AlertCircle
} from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { GroupAccessGuide } from '@/components/GroupAccessGuide'

interface GroupScope {
    groupId: string
    groupName?: string
    presetId?: string
    enabled: boolean
    triggerMode?: string
    settings?: Record<string, unknown>
    createdAt?: number
    updatedAt?: number
}

interface Preset {
    id: string
    name: string
}

const triggerModeNames: Record<string, string> = {
    default: '默认',
    at: '仅@触发',
    prefix: '仅前缀',
    all: '全部消息'
}

export default function GroupsPage() {
    const router = useRouter()
    const [groups, setGroups] = useState<GroupScope[]>([])
    const [presets, setPresets] = useState<Preset[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deletingGroup, setDeletingGroup] = useState<GroupScope | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
    const [togglingGroup, setTogglingGroup] = useState<string | null>(null)

    const fetchData = async () => {
        setLoading(true)
        setError(null)
        try {
            const [groupsRes, presetsRes] = await Promise.all([
                scopeApi.getGroups(),
                presetsApi.list()
            ])
            
            // 兼容不同的API返回格式
            const groupsData = Array.isArray(groupsRes) ? groupsRes : (groupsRes?.data || [])
            const presetsData = Array.isArray(presetsRes) ? presetsRes : (presetsRes?.data || [])

            setGroups(groupsData)
            setPresets(presetsData)
        } catch (error) {
            console.error('Fetch groups error:', error)
            setError('加载群组数据失败，请检查网络连接或后端服务状态。')
            toast.error('加载数据失败')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const handleDelete = async () => {
        if (!deletingGroup) return
        setDeleting(true)
        try {
            await scopeApi.deleteGroup(deletingGroup.groupId)
            toast.success('群组配置已删除')
            // Optimistic update or refresh
            setGroups(prev => prev.filter(g => g.groupId !== deletingGroup.groupId))
        } catch (error) {
            console.error(error)
            toast.error('删除失败')
            fetchData() // Revert state on error
        } finally {
            setDeleting(false)
            setDeleteDialogOpen(false)
            setDeletingGroup(null)
        }
    }

    const handleToggleEnabled = async (group: GroupScope) => {
        setTogglingGroup(group.groupId)
        try {
            const newEnabled = !group.enabled
            await scopeApi.updateGroup(group.groupId, {
                enabled: newEnabled
            })
            setGroups(prev =>
                prev.map(g => (g.groupId === group.groupId ? { ...g, enabled: newEnabled } : g))
            )
            toast.success(newEnabled ? '已启用' : '已禁用')
        } catch (error) {
            console.error(error)
            toast.error('操作失败')
        } finally {
            setTogglingGroup(null)
        }
    }

    const filteredGroups = useMemo(() => {
        return groups.filter(group => {
            const matchesSearch =
                !searchQuery ||
                group.groupId.includes(searchQuery) ||
                group.groupName?.toLowerCase().includes(searchQuery.toLowerCase())
            const matchesStatus =
                statusFilter === 'all' ||
                (statusFilter === 'enabled' && group.enabled) ||
                (statusFilter === 'disabled' && !group.enabled)
            return matchesSearch && matchesStatus
        })
    }, [groups, searchQuery, statusFilter])

    const getPresetName = (presetId?: string) => {
        if (!presetId) return '默认'
        const preset = presets.find(p => p.id === presetId)
        return preset?.name || '未知预设'
    }

    if (loading) {
        return (
            <div className="container max-w-7xl py-6 space-y-6 animate-in fade-in duration-500">
                <div className="flex items-center justify-between">
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                    <Skeleton className="h-10 w-24" />
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[...Array(6)].map((_, i) => (
                        <Card key={i} className="overflow-hidden">
                            <CardContent className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <Skeleton className="h-12 w-12 rounded-full" />
                                    <Skeleton className="h-6 w-16" />
                                </div>
                                <Skeleton className="h-6 w-32 mb-2" />
                                <Skeleton className="h-4 w-24 mb-4" />
                                <div className="flex gap-2">
                                    <Skeleton className="h-5 w-16" />
                                    <Skeleton className="h-5 w-16" />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="container max-w-7xl py-6 flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <Alert variant="destructive" className="max-w-lg">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>错误</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
                <Button onClick={fetchData} variant="outline">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    重试
                </Button>
            </div>
        )
    }

    return (
        <div className="container max-w-7xl py-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Users className="h-8 w-8 text-primary" />
                        群组管理
                    </h1>
                    <p className="text-muted-foreground mt-1">配置群聊个性化设置、独立人设和权限管理</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchData} className="h-9">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        刷新
                    </Button>
                    <Button size="sm" onClick={() => router.push('/groups/edit?id=new')} className="h-9">
                        <Plus className="h-4 w-4 mr-2" />
                        添加群组
                    </Button>
                </div>
            </div>

            {/* Access Guide */}
            <GroupAccessGuide variant="compact" />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card p-4 rounded-lg border shadow-sm">
                <div className="flex gap-6 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">总群组</span>
                        <Badge variant="secondary" className="px-2 min-w-[2rem] justify-center">{groups.length}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">活跃中</span>
                        <Badge variant="default" className="bg-green-500/15 text-green-600 hover:bg-green-500/25 border-green-200 dark:border-green-900 px-2 min-w-[2rem] justify-center">
                            {groups.filter(g => g.enabled).length}
                        </Badge>
                    </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto flex-1 sm:flex-none justify-end">
                    <div className="relative flex-1 sm:w-64 max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="搜索群号或名称..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-9 h-9"
                        />
                    </div>
                    <Select value={statusFilter} onValueChange={(v: 'all' | 'enabled' | 'disabled') => setStatusFilter(v)}>
                        <SelectTrigger className="w-[110px] h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="enabled">已启用</SelectItem>
                            <SelectItem value="disabled">已禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Grid */}
            {filteredGroups.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-4">
                            <Users className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">
                            {searchQuery ? '未找到匹配的群组' : '暂无群组配置'}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                            {searchQuery ? '请尝试更换搜索关键词或筛选条件' : '您还没有配置任何群组，点击下方按钮开始配置第一个群组'}
                        </p>
                        {!searchQuery && (
                            <Button onClick={() => router.push('/groups/edit?id=new')}>
                                <Plus className="h-4 w-4 mr-2" />
                                添加群组
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredGroups.map(group => (
                        <Card
                            key={group.groupId}
                            className={cn(
                                'group transition-all hover:shadow-md cursor-pointer border-l-4',
                                group.enabled ? 'border-l-green-500' : 'border-l-muted opacity-80'
                            )}
                            onClick={() => router.push(`/groups/edit?id=${group.groupId}`)}
                        >
                            <CardContent className="p-5">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 min-w-0 mr-2">
                                        <h3 className="font-semibold truncate text-base mb-1" title={group.groupName || group.groupId}>
                                            {group.groupName || '未命名群组'}
                                        </h3>
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded w-fit">
                                            <span>#</span>
                                            {group.groupId}
                                        </div>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    router.push(`/groups/edit?id=${group.groupId}`)
                                                }}
                                            >
                                                <Settings className="h-4 w-4 mr-2" />
                                                编辑配置
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    handleToggleEnabled(group)
                                                }}
                                                disabled={togglingGroup === group.groupId}
                                            >
                                                {togglingGroup === group.groupId ? (
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                ) : group.enabled ? (
                                                    <PowerOff className="h-4 w-4 mr-2" />
                                                ) : (
                                                    <Power className="h-4 w-4 mr-2" />
                                                )}
                                                {group.enabled ? '禁用' : '启用'}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    setDeletingGroup(group)
                                                    setDeleteDialogOpen(true)
                                                }}
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                删除
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.presetId && (
                                            <Badge variant="outline" className="text-xs font-normal">
                                                <MessageSquare className="h-3 w-3 mr-1 opacity-70" />
                                                {getPresetName(group.presetId)}
                                            </Badge>
                                        )}
                                        {group.triggerMode && group.triggerMode !== 'default' && (
                                            <Badge variant="outline" className="text-xs font-normal">
                                                <Zap className="h-3 w-3 mr-1 opacity-70" />
                                                {triggerModeNames[group.triggerMode] || group.triggerMode}
                                            </Badge>
                                        )}
                                    </div>
                                    
                                    {/* Features Indicator */}
                                    <div className="flex items-center gap-3 pt-2 border-t text-xs text-muted-foreground">
                                        <div className={cn("flex items-center gap-1", group.settings?.bymEnabled ? "text-primary" : "opacity-50")}>
                                            <div className={cn("w-1.5 h-1.5 rounded-full", group.settings?.bymEnabled ? "bg-primary" : "bg-muted-foreground")} />
                                            伪人
                                        </div>
                                        <div className={cn("flex items-center gap-1", (group.settings?.independentChannels as unknown[])?.length > 0 ? "text-primary" : "opacity-50")}>
                                            <div className={cn("w-1.5 h-1.5 rounded-full", (group.settings?.independentChannels as unknown[])?.length > 0 ? "bg-primary" : "bg-muted-foreground")} />
                                            独立渠道
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Delete Dialog */}
            <DeleteDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="删除群组配置"
                description={`确定要删除群组 "${deletingGroup?.groupName || deletingGroup?.groupId}" 的配置吗？删除后将恢复默认设置，此操作不可撤销。`}
                onConfirm={handleDelete}
                loading={deleting}
            />
        </div>
    )
}
