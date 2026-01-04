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
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
} from '@/components/ui/dialog'
import { toolsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, History, CheckCircle, XCircle, Clock, Loader2, Trash2, Search } from 'lucide-react'

interface ToolLog {
  id?: string
  toolName: string
  arguments?: Record<string, unknown>
  request?: Record<string, unknown>  // 后端可能返回 request 或 arguments
  result?: unknown
  response?: unknown  // 后端可能返回 response 或 result
  timestamp: number
  duration: number
  success: boolean
  userId?: string
  groupId?: string
  error?: string
  source?: string
}

export default function HistoryPage() {
  const [logs, setLogs] = useState<ToolLog[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLog, setSelectedLog] = useState<ToolLog | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [toolFilter, setToolFilter] = useState<string>('all')
  const [clearing, setClearing] = useState(false)

  const fetchLogs = async () => {
    try {
      const res = await toolsApi.getLogs() as { data?: ToolLog[] }
      const data = res?.data || []
      setLogs(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error('加载日志失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleClearLogs = async () => {
    if (!confirm('确定要清空所有调用记录吗？')) return
    setClearing(true)
    try {
      await toolsApi.clearLogs()
      setLogs([])
      toast.success('日志已清空')
    } catch {
      toast.error('清空失败')
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  // 提取所有工具名称用于筛选
  const toolNames = Array.from(new Set(logs.map(l => l.toolName)))

  // 筛选后的日志
  const filteredLogs = logs.filter(log => {
    const matchSearch = !searchQuery || 
      log.toolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.userId?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchTool = toolFilter === 'all' || log.toolName === toolFilter
    return matchSearch && matchTool
  })

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const formatDuration = (duration: number) => {
    if (duration < 1000) return `${duration}ms`
    return `${(duration / 1000).toFixed(2)}s`
  }

  const formatJson = (data: unknown): string => {
    try {
      // 递归解析嵌套的 JSON 字符串
      const deepParse = (obj: unknown): unknown => {
        if (typeof obj === 'string') {
          // 尝试解析 JSON 字符串
          try {
            const parsed = JSON.parse(obj)
            return deepParse(parsed)
          } catch {
            return obj
          }
        }
        if (Array.isArray(obj)) {
          return obj.map(deepParse)
        }
        if (obj && typeof obj === 'object') {
          const result: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(obj)) {
            result[key] = deepParse(value)
          }
          return result
        }
        return obj
      }
      
      const parsed = deepParse(data)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return String(data)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const successCount = logs.filter(l => l.success).length
  const failCount = logs.filter(l => !l.success).length
  const avgDuration = logs.length > 0 
    ? Math.round(logs.reduce((acc, l) => acc + l.duration, 0) / logs.length)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">调用记录</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchLogs}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button 
            variant="outline" 
            onClick={handleClearLogs} 
            disabled={clearing || logs.length === 0}
            className="text-destructive hover:text-destructive"
          >
            {clearing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            清空
          </Button>
        </div>
      </div>

      {/* 筛选区域 */}
      {logs.length > 0 && (
        <div className="flex gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索工具名或用户..."
              className="pl-9"
            />
          </div>
          <Select value={toolFilter} onValueChange={setToolFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="筛选工具" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部工具</SelectItem>
              {toolNames.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">总调用次数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              成功
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{successCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <XCircle className="h-4 w-4 text-red-500" />
              失败
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{failCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-4 w-4" />
              平均耗时
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(avgDuration)}</div>
          </CardContent>
        </Card>
      </div>

      {filteredLogs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {logs.length === 0 ? '暂无调用记录' : '没有匹配的记录'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-450px)]">
          <div className="space-y-3">
            {filteredLogs.slice().reverse().map((log, index) => (
              <Card 
                key={log.id || index} 
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setSelectedLog(log)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{log.toolName}</span>
                        <Badge variant={log.success ? 'default' : 'destructive'}>
                          {log.success ? '成功' : '失败'}
                        </Badge>
                        <Badge variant="outline">{formatDuration(log.duration)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatTime(log.timestamp)}
                        {log.userId && ` · 用户: ${log.userId}`}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* 详情对话框 */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedLog?.toolName}
              <Badge variant={selectedLog?.success ? 'default' : 'destructive'}>
                {selectedLog?.success ? '成功' : '失败'}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedLog && formatTime(selectedLog.timestamp)} · 耗时 {selectedLog && formatDuration(selectedLog.duration)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-4 pr-4">
              <div>
                <h4 className="font-medium mb-2">参数</h4>
                <pre className="bg-muted p-3 rounded-lg text-sm overflow-x-auto overflow-y-auto max-h-[200px] whitespace-pre-wrap break-all">
                  {formatJson(selectedLog?.arguments || selectedLog?.request || {})}
                </pre>
              </div>
              <div>
                <h4 className="font-medium mb-2">结果</h4>
                <pre className="bg-muted p-3 rounded-lg text-sm overflow-x-auto overflow-y-auto max-h-[300px] whitespace-pre-wrap break-all">
                  {formatJson(selectedLog?.result || selectedLog?.response || {})}
                </pre>
              </div>
              {selectedLog?.error && (
                <div>
                  <h4 className="font-medium mb-2 text-destructive">错误</h4>
                  <pre className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm whitespace-pre-wrap break-all">
                    {selectedLog.error}
                  </pre>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
