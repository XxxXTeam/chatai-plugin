'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usageStatsApi } from '@/lib/api'
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
  TrendingUp,
  Key,
  Server,
  BarChart3
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
  channelSwitched?: boolean
  previousChannelId?: string
  switchChain?: string[]
  userId?: string
  groupId?: string
}

interface UsageStats {
  today: {
    total: number
    success: number
    failed: number
    totalTokens: number
    avgDuration: number
  }
  byChannel: Record<string, { calls: number; tokens: number }>
  byModel: Record<string, { calls: number; tokens: number }>
  records: UsageRecord[]
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
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
      setStats((statsRes as any)?.data || null)
      setRecords((recordsRes as any)?.data || [])
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
    } catch (error) {
      toast.error('清除失败')
    } finally {
      setClearing(false)
    }
  }

  // 统计卡片数据 (后端字段: totalCalls, successCalls, totalInputTokens, totalOutputTokens, avgDuration)
  const todayStats = stats?.today as any
  const statCards = stats ? [
    {
      title: '今日调用',
      value: formatNumber(todayStats?.totalCalls || 0),
      icon: Activity,
      color: 'text-blue-500'
    },
    {
      title: '成功率',
      value: todayStats?.totalCalls ? `${((todayStats.successCalls / todayStats.totalCalls) * 100).toFixed(1)}%` : '0%',
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
  ] : []

  // 模型排行 (后端返回数组: [{ model, calls, tokens, duration }, ...])
  const modelRanking = (stats as any)?.modelRanking 
    ? ((stats as any).modelRanking as any[]).map(item => ({ name: item.model, calls: item.calls, tokens: item.tokens })).slice(0, 5)
    : []

  // 渠道排行 (后端返回数组: [{ channelId, channelName, calls, tokens, ... }, ...])
  const channelRanking = (stats as any)?.channelRanking
    ? ((stats as any).channelRanking as any[]).map(item => ({ name: item.channelName || item.channelId, calls: item.calls, tokens: item.tokens })).slice(0, 5)
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
                      <span className="text-sm font-medium text-muted-foreground w-5">{i + 1}</span>
                      <span className="text-sm font-medium truncate max-w-[150px]">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{item.calls}次</Badge>
                      <span className="text-xs text-muted-foreground">{formatNumber(item.tokens)} tokens</span>
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
                      <span className="text-sm font-medium text-muted-foreground w-5">{i + 1}</span>
                      <span className="text-sm font-medium truncate max-w-[150px]">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{item.calls}次</Badge>
                      <span className="text-xs text-muted-foreground">{formatNumber(item.tokens)} tokens</span>
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
              <Select value={filter.source} onValueChange={(v) => setFilter(f => ({ ...f, source: v }))}>
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
              <Select value={filter.status} onValueChange={(v) => setFilter(f => ({ ...f, status: v }))}>
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
                <TableRow>
                  <TableHead className="w-[100px]">时间</TableHead>
                  <TableHead>渠道</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead className="hidden lg:table-cell">Key</TableHead>
                  <TableHead className="hidden md:table-cell text-center">流式</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">输入</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">输出</TableHead>
                  <TableHead className="hidden sm:table-cell">来源</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                  <TableHead className="hidden xl:table-cell">切换</TableHead>
                  <TableHead className="text-center">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length > 0 ? records.map((record) => (
                  <TableRow 
                    key={record.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedRecord(record)}
                  >
                    <TableCell className="text-xs whitespace-nowrap">{formatTime(record.timestamp)}</TableCell>
                    <TableCell>
                      <span className="truncate max-w-[80px] inline-block text-sm">{record.channelName || record.channelId}</span>
                    </TableCell>
                    <TableCell>
                      <span className="truncate max-w-[100px] inline-block text-sm">{record.model}</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant="outline" className="text-xs">Key {record.keyIndex >= 0 ? record.keyIndex + 1 : 0}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-center">
                      {record.stream ? <Badge variant="secondary" className="text-xs">流</Badge> : <span className="text-muted-foreground text-xs">-</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-xs">{formatNumber(record.inputTokens)}</TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-xs">{formatNumber(record.outputTokens)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={
                        record.source === 'chat' ? 'default' : 
                        record.source === 'bym' ? 'default' :
                        record.source === 'test' || record.source === 'health_check' ? 'secondary' : 
                        record.source === 'imagegen' ? 'default' :
                        record.source?.startsWith('memory') ? 'outline' : 'outline'
                      } className="text-xs">
                        {record.source === 'chat' ? '对话' : 
                         record.source === 'bym' ? '伪人' :
                         record.source === 'test' ? '测试' : 
                         record.source === 'health_check' ? '检查' :
                         record.source === 'imagegen' ? '绘图' :
                         record.source === 'memory_group' ? '群记忆' :
                         record.source === 'memory_user' ? '用户记忆' :
                         record.source === 'memory_extract' ? '记忆提取' :
                         record.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap">{formatDuration(record.duration)}</TableCell>
                    <TableCell className="hidden xl:table-cell text-xs">
                      {record.channelSwitched ? (
                        <span className="text-orange-500">{record.previousChannelId} → {record.channelId}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {record.success ? (
                        <CheckCircle className="h-4 w-4 text-green-500 inline" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 inline" />
                      )}
                    </TableCell>
                  </TableRow>
                )) : (
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
        <DialogContent className="w-[95vw] max-w-lg">
          <DialogHeader>
            <DialogTitle>调用详情</DialogTitle>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">时间</span>
                  <p className="font-medium">{formatTime(selectedRecord.timestamp)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">状态</span>
                  <p className="font-medium flex items-center gap-1">
                    {selectedRecord.success ? (
                      <><CheckCircle className="h-4 w-4 text-green-500" /> 成功</>
                    ) : (
                      <><XCircle className="h-4 w-4 text-red-500" /> 失败</>
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">渠道</span>
                  <p className="font-medium">{selectedRecord.channelName || selectedRecord.channelId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">模型</span>
                  <p className="font-medium">{selectedRecord.model}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">API Key</span>
                  <p className="font-medium">{selectedRecord.keyName || `Key ${selectedRecord.keyIndex + 1}`}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">轮询策略</span>
                  <p className="font-medium">{selectedRecord.strategy || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">耗时</span>
                  <p className="font-medium">{formatDuration(selectedRecord.duration)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">来源</span>
                  <p className="font-medium">{selectedRecord.source || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">输入Token</span>
                  <p className="font-medium">{formatNumber(selectedRecord.inputTokens)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">输出Token</span>
                  <p className="font-medium">{formatNumber(selectedRecord.outputTokens)}</p>
                </div>
              </div>
              {selectedRecord.error && (
                <div>
                  <span className="text-muted-foreground text-sm">错误信息</span>
                  <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 p-2 rounded mt-1">
                    {selectedRecord.error}
                  </p>
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
            <Button variant="outline" onClick={() => setClearDialogOpen(false)}>取消</Button>
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
