'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
    MoreHorizontal
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
    const [searchQuery, setSearchQuery] = useState('')
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deletingGroup, setDeletingGroup] = useState<GroupScope | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
    const [togglingGroup, setTogglingGroup] = useState<string | null>(null)

    const fetchData = async () => {
        try {
            const [groupsRes, presetsRes] = await Promise.all([
                scopeApi.getGroups(),
                presetsApi.list()
            ])
            setGroups(groupsRes?.data || [])
            setPresets(presetsRes?.data || [])
        } catch (error) {
            toast.error('加载数据失败')
            console.error(error)
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
            fetchData()
        } catch (error) {
            toast.error('删除失败')
            console.error(error)
        } finally {
            setDeleting(false)
            setDeleteDialogOpen(false)
            setDeletingGroup(null)
        }
    }

    const handleToggleEnabled = async (group: GroupScope) => {
        setTogglingGroup(group.groupId)
        try {
            await scopeApi.updateGroup(group.groupId, {
                enabled: !group.enabled
            })
            setGroups(prev =>
                prev.map(g => (g.groupId === group.groupId ? { ...g, enabled: !g.enabled } : g))
            )
            toast.success(group.enabled ? '已禁用' : '已启用')
        } catch (error) {
            toast.error('操作失败')
            console.error(error)
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
            <div className="container py-6 space-y-6">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-10 w-24" />
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[...Array(6)].map((_, i) => (
                        <Card key={i}>
                            <CardContent className="p-4">
                                <Skeleton className="h-6 w-32 mb-2" />
                                <Skeleton className="h-4 w-48" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="container py-6 space-y-6">
            {/* 头部 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="h-6 w-6" />
                        群组管理
                    </h1>
                    <p className="text-sm text-muted-foreground">配置群聊个性化设置和独立人设</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchData()}>
                        <RefreshCw className="h-4 w-4 mr-1" />
                        刷新
                    </Button>
                    <Button size="sm" onClick={() => router.push('/groups/edit?id=new')}>
                        <Plus className="h-4 w-4 mr-1" />
                        添加群
                    </Button>
                </div>
            </div>

            {/* 统计和筛选 */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">总数</span>
                        <Badge variant="secondary">{groups.length}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">已启用</span>
                        <Badge variant="default">{groups.filter(g => g.enabled).length}</Badge>
                    </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="搜索群号或群名称..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <Select value={statusFilter} onValueChange={(v: 'all' | 'enabled' | 'disabled') => setStatusFilter(v)}>
                        <SelectTrigger className="w-28">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部</SelectItem>
                            <SelectItem value="enabled">已启用</SelectItem>
                            <SelectItem value="disabled">已禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* 群组列表 */}
            {filteredGroups.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Users className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-lg font-medium mb-2">
                            {searchQuery ? '未找到匹配的群组' : '暂无群组配置'}
                        </p>
                        <p className="text-sm text-muted-foreground mb-4">
                            {searchQuery ? '尝试修改搜索条件' : '点击上方按钮添加群组'}
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
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredGroups.map(group => (
                        <Card
                            key={group.groupId}
                            className={cn(
                                'transition-all hover:shadow-md cursor-pointer',
                                !group.enabled && 'opacity-60'
                            )}
                            onClick={() => router.push(`/groups/edit?id=${group.groupId}`)}
                        >
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-semibold truncate">
                                                {group.groupName || group.groupId}
                                            </h3>
                                            <Badge variant={group.enabled ? 'default' : 'secondary'} className="shrink-0">
                                                {group.enabled ? '已启用' : '已禁用'}
                                            </Badge>
                                        </div>
                                        {group.groupName && (
                                            <p className="text-xs text-muted-foreground mb-2">
                                                群号: {group.groupId}
                                            </p>
                                        )}
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {group.presetId && (
                                                <Badge variant="outline" className="text-xs">
                                                    预设: {getPresetName(group.presetId)}
                                                </Badge>
                                            )}
                                            {group.triggerMode && group.triggerMode !== 'default' && (
                                                <Badge variant="outline" className="text-xs">
                                                    {triggerModeNames[group.triggerMode] || group.triggerMode}
                                                </Badge>
                                            )}
                                            {group.settings?.bymEnabled && (
                                                <Badge variant="outline" className="text-xs">伪人</Badge>
                                            )}
                                            {(group.settings?.independentChannels as unknown[])?.length > 0 && (
                                                <Badge variant="outline" className="text-xs">独立渠道</Badge>
                                            )}
                                        </div>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
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
                                                className="text-destructive"
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
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* 删除确认对话框 */}
            <DeleteDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="删除群组配置"
                description={`确定要删除群组 ${deletingGroup?.groupName || deletingGroup?.groupId} 的配置吗？此操作不可撤销。`}
                onConfirm={handleDelete}
                loading={deleting}
            />
        </div>
    )
}
