'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usageStatsApi } from '@/lib/api'
import { JsonView } from '@/components/ui/code-block'
import { toast } from 'sonner'
import {
    RefreshCw,
    CheckCircle,
    XCircle,
    Clock,
    Loader2,
    Trash2,
    Activity,
    Zap,
    Key,
    Server,
    BarChart3,
    TrendingUp
} from 'lucide-react'

interface UsageRecord {
    id: string
    timestamp: number
    channelId: string
    channelName: string
    model: string
    keyIndex: number
    keyName: string
    strategy: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    duration: number
    success: boolean
    error?: string
    source: string
    stream?: boolean
    retryCount?: number
    channelSwitched?: boolean
    previousChannelId?: string
    switchChain?: string[]
    userId?: string
    groupId?: string
    request?: Record<string, unknown>
    response?: Record<string, unknown>
}

interface UsageStats {
    today: {
        total: number
        success: number
        failed: number
        totalTokens: number
        avgDuration: number
        totalCalls?: number
        successCalls?: number
        totalInputTokens?: number
        totalOutputTokens?: number
    }
    byChannel: Record<string, { calls: number; tokens: number }>
    byModel: Record<string, { calls: number; tokens: number }>
    records: UsageRecord[]
    modelRanking?: Array<{ model: string; calls: number; tokens: number }>
    channelRanking?: Array<{ channelId: string; channelName?: string; calls: number; tokens: number }>
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

function getDurationStyle(ms: number): string {
    if (ms < 3000) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    if (ms < 10000) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    if (ms < 30000) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
}
function getSourceStyle(source: string): { bg: string; text: string; label: string } {
    switch (source) {
        case 'chat':
            return {
                bg: 'bg-purple-100 dark:bg-purple-900/30',
                text: 'text-purple-700 dark:text-purple-400',
                label: '消费'
            }
        case 'bym':
            return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: '伪人' }
        case 'test':
            return { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400', label: '测试' }
        case 'health_check':
            return { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400', label: '检查' }
        case 'imagegen':
            return { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-400', label: '绘图' }
        default:
            if (source?.startsWith('memory'))
                return {
                    bg: 'bg-cyan-100 dark:bg-cyan-900/30',
                    text: 'text-cyan-700 dark:text-cyan-400',
                    label: '记忆'
                }
            return {
                bg: 'bg-gray-100 dark:bg-gray-800',
                text: 'text-gray-600 dark:text-gray-400',
                label: source || '-'
            }
    }
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}

function formatNumber(num: number): string {
    if (!num) return '0'
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
    return String(num)
}

export default function UsageStatsPage() {
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [stats, setStats] = useState<UsageStats | null>(null)
    const [records, setRecords] = useState<UsageRecord[]>([])
    const [selectedRecord, setSelectedRecord] = useState<UsageRecord | null>(null)
    const [clearDialogOpen, setClearDialogOpen] = useState(false)
    const [clearing, setClearing] = useState(false)
    const [filter, setFilter] = useState({ source: 'all', status: 'all' })

    const fetchData = async () => {
        try {
            const [statsRes, recordsRes] = await Promise.all([
                usageStatsApi.get(),
                usageStatsApi.getRecent(100, {
                    source: filter.source !== 'all' ? filter.source : undefined,
                    status: filter.status !== 'all' ? filter.status : undefined
                })
            ])
            setStats((statsRes as { data?: UsageStats })?.data || null)
            setRecords((recordsRes as { data?: UsageRecord[] })?.data || [])
        } catch (error) {
            console.error('Failed to fetch usage stats:', error)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [filter])

    const handleRefresh = () => {
        setRefreshing(true)
        fetchData()
    }

    const handleClear = async () => {
        setClearing(true)
        try {
            await usageStatsApi.clear()
            toast.success('调用记录已清除')
            setClearDialogOpen(false)
            fetchData()
        } catch {
            toast.error('清除失败')
        } finally {
            setClearing(false)
        }
    }

    // 统计卡片数据 (后端字段: totalCalls, successCalls, totalInputTokens, totalOutputTokens, avgDuration)
    const todayStats = stats?.today
    const statCards = stats
        ? [
              {
                  title: '今日调用',
                  value: formatNumber(todayStats?.totalCalls || 0),
                  icon: Activity,
                  color: 'text-blue-500'
              },
              {
                  title: '成功率',
                  value: todayStats?.totalCalls
                      ? `${((todayStats.successCalls / todayStats.totalCalls) * 100).toFixed(1)}%`
                      : '0%',
                  icon: CheckCircle,
                  color: 'text-green-500'
              },
              {
                  title: 'Token消耗',
                  value: formatNumber((todayStats?.totalInputTokens || 0) + (todayStats?.totalOutputTokens || 0)),
                  icon: Zap,
                  color: 'text-yellow-500'
              },
              {
                  title: '平均耗时',
                  value: formatDuration(todayStats?.avgDuration || 0),
                  icon: Clock,
                  color: 'text-purple-500'
              }
          ]
        : []

    // 模型排行 (后端返回数组: [{ model, calls, tokens, duration }, ...])
    const modelRanking = stats?.modelRanking
        ? stats.modelRanking.map(item => ({ name: item.model, calls: item.calls, tokens: item.tokens })).slice(0, 5)
        : []

    // 渠道排行 (后端返回数组: [{ channelId, channelName, calls, tokens, ... }, ...])
    const channelRanking = stats?.channelRanking
        ? stats.channelRanking
              .map(item => ({ name: item.channelName || item.channelId, calls: item.calls, tokens: item.tokens }))
              .slice(0, 5)
        : []

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-4 w-48 mt-2" />
                    </div>
                </div>
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map(i => (
                        <Card key={i}>
                            <CardHeader className="pb-2">
                                <Skeleton className="h-4 w-20" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-8 w-16" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* 页面标题 */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                        <Activity className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold sm:text-2xl">调用统计</h1>
                        <p className="text-sm text-muted-foreground">API请求统计与历史记录</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        刷新
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setClearDialogOpen(true)}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        清除
                    </Button>
                </div>
            </div>

            {/* 统计卡片 */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {statCards.map((card, i) => (
                    <Card key={i}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                            <card.icon className={`h-4 w-4 ${card.color}`} />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{card.value}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* 排行榜 */}
            <div className="grid gap-4 md:grid-cols-2">
                {/* 模型排行 */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            模型调用排行
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {modelRanking.length > 0 ? (
                            <div className="space-y-3">
                                {modelRanking.map((item, i) => (
                                    <div key={item.name} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-muted-foreground w-5">
                                                {i + 1}
                                            </span>
                                            <span className="text-sm font-medium truncate max-w-[150px]">
                                                {item.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary">{item.calls}次</Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {formatNumber(item.tokens)} tokens
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>
                        )}
                    </CardContent>
                </Card>

                {/* 渠道排行 */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Server className="h-4 w-4" />
                            渠道调用排行
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {channelRanking.length > 0 ? (
                            <div className="space-y-3">
                                {channelRanking.map((item, i) => (
                                    <div key={item.name} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-muted-foreground w-5">
                                                {i + 1}
                                            </span>
                                            <span className="text-sm font-medium truncate max-w-[150px]">
                                                {item.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary">{item.calls}次</Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {formatNumber(item.tokens)} tokens
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">暂无数据</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* 调用记录表格 */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            调用记录
                        </CardTitle>
                        <div className="flex gap-2 flex-wrap">
                            <Select value={filter.source} onValueChange={v => setFilter(f => ({ ...f, source: v }))}>
                                <SelectTrigger className="w-[130px] h-8">
                                    <SelectValue placeholder="来源" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">全部来源</SelectItem>
                                    <SelectItem value="chat">对话</SelectItem>
                                    <SelectItem value="bym">伪人</SelectItem>
                                    <SelectItem value="test">测试</SelectItem>
                                    <SelectItem value="health_check">健康检查</SelectItem>
                                    <SelectItem value="imagegen">绘图</SelectItem>
                                    <SelectItem value="memory_group">群记忆</SelectItem>
                                    <SelectItem value="memory_user">用户记忆</SelectItem>
                                    <SelectItem value="memory_extract">记忆提取</SelectItem>
                                    <SelectItem value="api">API</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={filter.status} onValueChange={v => setFilter(f => ({ ...f, status: v }))}>
                                <SelectTrigger className="w-[120px] h-8">
                                    <SelectValue placeholder="状态" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">全部状态</SelectItem>
                                    <SelectItem value="success">成功</SelectItem>
                                    <SelectItem value="failed">失败</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[400px]">
                        <Table>
                            <TableHeader>
                                <TableRow className="text-xs">
                                    <TableHead className="w-[130px]">时间</TableHead>
                                    <TableHead className="w-[60px]">渠道</TableHead>
                                    <TableHead className="hidden md:table-cell w-[50px]">Key</TableHead>
                                    <TableHead className="hidden lg:table-cell">类型</TableHead>
                                    <TableHead>模型</TableHead>
                                    <TableHead className="w-[70px]">用时</TableHead>
                                    <TableHead className="hidden md:table-cell w-[50px] text-center">流式</TableHead>
                                    <TableHead className="hidden lg:table-cell text-right">输入</TableHead>
                                    <TableHead className="hidden lg:table-cell text-right">输出</TableHead>
                                    <TableHead className="hidden xl:table-cell">重试</TableHead>
                                    <TableHead className="text-center">状态</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {records.length > 0 ? (
                                    records.map(record => {
                                        const sourceStyle = getSourceStyle(record.source)
                                        const durationStyle = getDurationStyle(record.duration)
                                        return (
                                            <TableRow
                                                key={record.id}
                                                className="cursor-pointer hover:bg-muted/50 text-xs"
                                                onClick={() => setSelectedRecord(record)}
                                            >
                                                <TableCell className="whitespace-nowrap font-mono">
                                                    {formatTime(record.timestamp)}
                                                </TableCell>
                                                <TableCell>
                                                    <span className="font-medium text-blue-600 dark:text-blue-400">
                                                        {record.channelName || record.channelId}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-center">
                                                    <span className="text-muted-foreground">
                                                        {record.keyIndex >= 0 ? record.keyIndex + 1 : 0}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell">
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sourceStyle.bg} ${sourceStyle.text}`}
                                                    >
                                                        {sourceStyle.label}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    <span
                                                        className="truncate max-w-[120px] inline-block text-muted-foreground"
                                                        title={record.model}
                                                    >
                                                        {record.model}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${durationStyle}`}
                                                    >
                                                        {formatDuration(record.duration)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-center">
                                                    <span className="text-muted-foreground">
                                                        {record.stream ? '流' : '非流'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-right tabular-nums">
                                                    {formatNumber(record.inputTokens)}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-right tabular-nums">
                                                    {formatNumber(record.outputTokens)}
                                                </TableCell>
                                                <TableCell className="hidden xl:table-cell">
                                                    {record.switchChain && record.switchChain.length > 1 ? (
                                                        <span
                                                            className="text-orange-500 truncate max-w-[100px] inline-block"
                                                            title={record.switchChain.join(' → ')}
                                                        >
                                                            {record.switchChain.join('→')}
                                                        </span>
                                                    ) : record.retryCount && record.retryCount > 0 ? (
                                                        <span className="text-orange-500">
                                                            重试:{record.retryCount}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {record.success ? (
                                                        <CheckCircle className="h-3.5 w-3.5 text-green-500 inline" />
                                                    ) : (
                                                        <XCircle className="h-3.5 w-3.5 text-red-500 inline" />
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                                            暂无调用记录
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* 详情对话框 */}
            <Dialog open={!!selectedRecord} onOpenChange={() => setSelectedRecord(null)}>
                <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            调用详情
                            {selectedRecord && (
                                <Badge variant={selectedRecord.success ? 'default' : 'destructive'}>
                                    {selectedRecord.success ? '成功' : '失败'}
                                </Badge>
                            )}
                        </DialogTitle>
                    </DialogHeader>
                    {selectedRecord && (
                        <div className="space-y-4">
                            {/* 基本信息 - 网格布局 */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm bg-muted/30 rounded-lg p-3">
                                <div>
                                    <span className="text-muted-foreground text-xs block">时间</span>
                                    <p className="font-medium">{formatTime(selectedRecord.timestamp)}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">耗时</span>
                                    <p className="font-medium">{formatDuration(selectedRecord.duration)}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">渠道</span>
                                    <p className="font-medium truncate">
                                        {selectedRecord.channelName || selectedRecord.channelId}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">模型</span>
                                    <p className="font-medium truncate">{selectedRecord.model}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">API Key</span>
                                    <p className="font-medium">
                                        {selectedRecord.keyName || `Key ${selectedRecord.keyIndex + 1}`}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">来源</span>
                                    <p className="font-medium">{selectedRecord.source || '-'}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">输入/输出</span>
                                    <p className="font-medium">
                                        {formatNumber(selectedRecord.inputTokens)} /{' '}
                                        {formatNumber(selectedRecord.outputTokens)}
                                    </p>
                                </div>
                                {selectedRecord.retryCount !== undefined && selectedRecord.retryCount > 0 && (
                                    <div>
                                        <span className="text-muted-foreground text-xs block">重试次数</span>
                                        <p className="font-medium text-orange-500">{selectedRecord.retryCount}</p>
                                    </div>
                                )}
                                {(selectedRecord.userId || selectedRecord.groupId) && (
                                    <div>
                                        <span className="text-muted-foreground text-xs block">用户/群组</span>
                                        <p className="font-medium truncate">
                                            {selectedRecord.userId || '-'} / {selectedRecord.groupId || '-'}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* 错误信息 - 失败时显示在顶部 */}
                            {selectedRecord.error && (
                                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3">
                                    <span className="text-xs font-medium text-red-500 block mb-1">错误信息</span>
                                    <p className="text-sm text-red-600 dark:text-red-400">{selectedRecord.error}</p>
                                </div>
                            )}

                            {/* 请求数据 */}
                            {selectedRecord.request && (
                                <div>
                                    <span className="text-muted-foreground text-sm font-medium mb-2 block">
                                        请求数据
                                    </span>
                                    <JsonView data={selectedRecord.request} maxHeight="300px" />
                                </div>
                            )}

                            {/* 失败响应详情 */}
                            {!selectedRecord.success && selectedRecord.response && (
                                <div>
                                    <span className="text-sm font-medium text-red-500 mb-2 block">响应详情</span>
                                    <JsonView data={selectedRecord.response} maxHeight="200px" />
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 清除确认对话框 */}
            <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认清除</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">确定要清除所有调用记录吗？此操作不可撤销。</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setClearDialogOpen(false)}>
                            取消
                        </Button>
                        <Button variant="destructive" onClick={handleClear} disabled={clearing}>
                            {clearing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            确认清除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
