'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Dialog,
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { statsApi, usageStatsApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  RefreshCw, 
  MessageSquare, 
  Bot, 
  Wrench, 
  Clock, 
  TrendingUp,
  Trash2,
  Loader2,
  PieChart as PieChartIcon,
  Activity,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

interface UsageRecord {
  id: string
  timestamp: number
  channelId: string
  channelName: string
  model: string
  inputTokens: number
  outputTokens: number
  duration: number
  success: boolean
  error?: string
  source: string
  userId?: string
  groupId?: string
  request?: {
    messageCount?: number
    systemPromptLength?: number
    lastUserMessage?: string
    hasImages?: boolean
    hasTools?: boolean
    toolCount?: number
    model?: string
  }
  response?: {
    error?: string
    status?: number
    code?: string
    data?: unknown
  }
}

interface StatsData {
  messages: {
    total: number
    conversations: number
    dbMessages: number
    types: Record<string, number>
    topGroups: Array<{ id: string; count: number }>
    topUsers: Array<{ id: string; count: number }>
    hourlyDistribution: Record<string, number>
  }
  models: {
    totalCalls: number
    byModel: Array<{ name: string; calls: number; success: number; failed: number; inputTokens: number; outputTokens: number }>
    byChannel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>
  }
  tokens: {
    total: { input: number; output: number }
    totalSum: number
    byModel: Array<{ name: string; input: number; output: number; total: number }>
    topUsers: Array<{ userId: string; input: number; output: number; total: number }>
  }
  tools: {
    totalCalls: number
    byTool: Array<{ name: string; calls: number; success: number; failed: number }>
  }
  uptime: { days: number; hours: number; startTime: number }
  lastUpdate: number
}

function formatNumber(num: number): string {
  if (!num) return '0'
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return String(num)
}

// 颜色配置
const CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7', '#eab308', '#22c55e', '#0ea5e9'
]

// 饼图组件
function PieChart({ 
  data, 
  size = 200 
}: { 
  data: Array<{ label: string; value: number; color?: string }>
  size?: number 
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  if (total === 0) return <div className="text-center text-muted-foreground py-8">暂无数据</div>
  
  // 预先计算累积角度
  const cumulativeAngles = data.reduce<number[]>((acc, item, idx) => {
    const prevAngle = idx === 0 ? 0 : acc[idx - 1] + (data[idx - 1].value / total) * 360
    acc.push(prevAngle)
    return acc
  }, [])
  
  const segments = data.map((item, idx) => {
    const percentage = item.value / total
    const angle = percentage * 360
    const startAngle = cumulativeAngles[idx]
    
    // 计算扇形路径
    const startRad = (startAngle - 90) * Math.PI / 180
    const endRad = (startAngle + angle - 90) * Math.PI / 180
    const radius = size / 2 - 10
    const cx = size / 2
    const cy = size / 2
    
    const x1 = cx + radius * Math.cos(startRad)
    const y1 = cy + radius * Math.sin(startRad)
    const x2 = cx + radius * Math.cos(endRad)
    const y2 = cy + radius * Math.sin(endRad)
    
    const largeArc = angle > 180 ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
    
    return {
      ...item,
      path,
      percentage,
      color: item.color || CHART_COLORS[idx % CHART_COLORS.length]
    }
  })
  
  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, idx) => (
          <path 
            key={idx} 
            d={seg.path} 
            fill={seg.color}
            stroke="white"
            strokeWidth="2"
            className="transition-opacity hover:opacity-80"
          >
            <title>{seg.label}: {seg.value} ({(seg.percentage * 100).toFixed(1)}%)</title>
          </path>
        ))}
        {/* 中心圆孔（可选，做成环形图） */}
        <circle cx={size/2} cy={size/2} r={size/5} fill="white" className="dark:fill-gray-900" />
        <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle" className="text-lg font-bold fill-current">
          {total}
        </text>
      </svg>
      
      {/* 图例 */}
      <div className="flex flex-wrap gap-2 justify-center max-w-full">
        {segments.slice(0, 8).map((seg, idx) => (
          <div key={idx} className="flex items-center gap-1 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: seg.color }} />
            <span className="truncate max-w-20">{seg.label}</span>
            <span className="text-muted-foreground">({(seg.percentage * 100).toFixed(0)}%)</span>
          </div>
        ))}
        {segments.length > 8 && (
          <span className="text-xs text-muted-foreground">+{segments.length - 8} 更多</span>
        )}
      </div>
    </div>
  )
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null)

  const fetchStats = async () => {
    try {
      setLoading(true)
      const [statsRes, usageRes] = await Promise.all([
        statsApi.getOverview(),
        usageStatsApi.getRecent(50)
      ])
      setStats((statsRes as { data: StatsData })?.data || null)
      setUsageRecords((usageRes as { data: UsageRecord[] })?.data || [])
    } catch (err) {
      toast.error('加载统计数据失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  const handleReset = async () => {
    setResetting(true)
    try {
      await statsApi.reset()
      toast.success('统计数据已重置')
      setResetDialogOpen(false)
      fetchStats()
    } catch (error) {
      toast.error('重置失败')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
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
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">使用统计</h2>
          <p className="text-muted-foreground text-sm">
            运行 {stats?.uptime.days || 0} 天 {stats?.uptime.hours || 0} 小时
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchStats}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button variant="destructive" onClick={() => setResetDialogOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            重置
          </Button>
        </div>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <MessageSquare className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">消息总数</p>
                <p className="text-2xl font-bold">{formatNumber(stats?.messages.total || 0)}</p>
                <p className="text-xs text-muted-foreground">{stats?.messages.conversations || 0} 个对话</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                <Bot className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">模型调用</p>
                <p className="text-2xl font-bold">{formatNumber(stats?.models.totalCalls || 0)}</p>
                <p className="text-xs text-muted-foreground">{stats?.models.byModel?.length || 0} 个模型</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tokens 消耗</p>
                <p className="text-2xl font-bold">{formatNumber(stats?.tokens.totalSum || 0)}</p>
                <p className="text-xs text-muted-foreground">
                  入 {formatNumber(stats?.tokens.total?.input || 0)} / 出 {formatNumber(stats?.tokens.total?.output || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-lg">
                <Wrench className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">工具调用</p>
                <p className="text-2xl font-bold">{formatNumber(stats?.tools.totalCalls || 0)}</p>
                <p className="text-xs text-muted-foreground">{stats?.tools.byTool?.length || 0} 个工具</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 详细统计 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 模型使用 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              模型使用统计
            </CardTitle>
            <CardDescription>按调用次数排序</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {stats?.models.byModel && stats.models.byModel.length > 0 ? (
                <div className="space-y-3">
                  {stats.models.byModel.map((model, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{model.name.split('/').pop()}</p>
                        <p className="text-xs text-muted-foreground">
                          成功 {model.success} / 失败 {model.failed}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{model.calls} 次</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(model.inputTokens + model.outputTokens)} tokens
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">暂无数据</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* 工具使用 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              工具使用统计
            </CardTitle>
            <CardDescription>按调用次数排序</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {stats?.tools.byTool && stats.tools.byTool.length > 0 ? (
                <div className="space-y-3">
                  {stats.tools.byTool.map((tool, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{tool.name}</p>
                        <p className="text-xs text-muted-foreground">
                          成功率 {tool.calls > 0 ? Math.round(tool.success / tool.calls * 100) : 0}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{tool.calls} 次</p>
                        <Badge variant={tool.failed > 0 ? 'destructive' : 'secondary'} className="text-xs">
                          {tool.failed > 0 ? `${tool.failed} 失败` : '全部成功'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">暂无数据</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* 消息类型分布 - 饼图 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              消息类型分布
            </CardTitle>
            <CardDescription>按类型统计的消息数量</CardDescription>
          </CardHeader>
          <CardContent>
            <PieChart
              data={Object.entries(stats?.messages.types || {})
                .sort((a, b) => b[1] - a[1])
                .map(([label, value]) => ({ label, value }))}
              size={220}
            />
          </CardContent>
        </Card>

        {/* 活跃群组分布 - 饼图 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              群组消息分布
            </CardTitle>
            <CardDescription>各群组的消息占比</CardDescription>
          </CardHeader>
          <CardContent>
            <PieChart
              data={(stats?.messages.topGroups || [])
                .slice(0, 10)
                .map(g => ({ label: g.id, value: g.count }))}
              size={220}
            />
          </CardContent>
        </Card>

        {/* 活跃用户分布 - 饼图 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              用户消息分布
            </CardTitle>
            <CardDescription>各用户的消息占比</CardDescription>
          </CardHeader>
          <CardContent>
            <PieChart
              data={(stats?.messages.topUsers || [])
                .slice(0, 10)
                .map(u => ({ label: u.id, value: u.count }))}
              size={220}
            />
          </CardContent>
        </Card>

        {/* Tokens 分布 - 饼图 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Tokens 模型分布
            </CardTitle>
            <CardDescription>各模型的 Tokens 消耗占比</CardDescription>
          </CardHeader>
          <CardContent>
            <PieChart
              data={(stats?.tokens.byModel || [])
                .slice(0, 10)
                .map(m => ({ label: m.name.split('/').pop() || m.name, value: m.total }))}
              size={220}
            />
          </CardContent>
        </Card>

        {/* 小时分布 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              消息时段分布
            </CardTitle>
            <CardDescription>24 小时消息分布热力图</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.messages.hourlyDistribution && Object.keys(stats.messages.hourlyDistribution).length > 0 ? (
              <div className="grid grid-cols-12 gap-1">
                {Array.from({ length: 24 }, (_, h) => {
                  const count = stats.messages.hourlyDistribution[h] || 0
                  const maxCount = Math.max(...Object.values(stats.messages.hourlyDistribution), 1)
                  const intensity = count / maxCount
                  return (
                    <div
                      key={h}
                      className="aspect-square rounded flex items-center justify-center text-xs font-medium"
                      style={{
                        backgroundColor: `rgba(59, 130, 246, ${Math.max(0.1, intensity)})`,
                        color: intensity > 0.5 ? 'white' : 'inherit'
                      }}
                      title={`${h}:00 - ${count} 条消息`}
                    >
                      {h}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">暂无数据</p>
            )}
          </CardContent>
        </Card>

        {/* 模型请求日志 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              模型请求日志
            </CardTitle>
            <CardDescription>最近的模型调用记录（成功仅记录请求，失败记录请求和响应）</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {usageRecords.length > 0 ? (
                <div className="space-y-2">
                  {usageRecords.map((record) => (
                    <div 
                      key={record.id} 
                      className={`p-3 rounded-lg border ${record.success ? 'bg-muted/30' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900'}`}
                    >
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
                      >
                        <div className="flex items-center gap-2">
                          {record.success ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="font-medium text-sm">{record.model?.split('/').pop() || record.model}</span>
                          <Badge variant="outline" className="text-xs">{record.channelName}</Badge>
                          <Badge variant="secondary" className="text-xs">{record.source}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{record.duration}ms</span>
                          <span>{formatNumber(record.inputTokens + record.outputTokens)} tokens</span>
                          <span>{new Date(record.timestamp).toLocaleTimeString()}</span>
                          {expandedRecord === record.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                      </div>
                      
                      {expandedRecord === record.id && (
                        <div className="mt-3 pt-3 border-t space-y-2 text-sm">
                          {record.request && (
                            <div>
                              <p className="font-medium text-xs text-muted-foreground mb-1">请求摘要</p>
                              <div className="bg-muted/50 p-2 rounded text-xs space-y-1">
                                {record.request.messageCount && <p>消息数: {record.request.messageCount}</p>}
                                {record.request.systemPromptLength && <p>系统提示长度: {record.request.systemPromptLength}</p>}
                                {record.request.lastUserMessage && (
                                  <p className="truncate">最后用户消息: {record.request.lastUserMessage}</p>
                                )}
                                {record.request.hasImages && <Badge variant="outline" className="text-xs">包含图片</Badge>}
                                {record.request.hasTools && <Badge variant="outline" className="text-xs">使用工具 ({record.request.toolCount})</Badge>}
                              </div>
                            </div>
                          )}
                          
                          {!record.success && record.error && (
                            <div>
                              <p className="font-medium text-xs text-red-500 mb-1">错误信息</p>
                              <div className="bg-red-100 dark:bg-red-950/50 p-2 rounded text-xs text-red-700 dark:text-red-300">
                                {record.error}
                              </div>
                            </div>
                          )}
                          
                          {!record.success && record.response && (
                            <div>
                              <p className="font-medium text-xs text-red-500 mb-1">响应详情</p>
                              <div className="bg-red-100 dark:bg-red-950/50 p-2 rounded text-xs text-red-700 dark:text-red-300">
                                <pre className="whitespace-pre-wrap overflow-auto max-h-32">
                                  {JSON.stringify(record.response, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                          
                          <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                            {record.userId && <span>用户: {record.userId}</span>}
                            {record.groupId && <span>群组: {record.groupId}</span>}
                            <span>渠道: {record.channelId}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">暂无请求记录</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 重置确认对话框 */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认重置统计</DialogTitle>
            <DialogDescription>
              此操作将清空所有统计数据，包括消息、模型调用、工具调用等记录。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleReset} disabled={resetting}>
              {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
