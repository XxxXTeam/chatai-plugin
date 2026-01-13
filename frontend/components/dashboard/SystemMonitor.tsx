'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { systemApi } from '@/lib/api'
import { Activity, Cpu, Database, Gauge, Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MonitorData {
    memory: {
        heapUsed: number
        heapTotal: number
        rss: number
        external: number
        systemTotal: number
        systemFree: number
        heapUsedPercent: number
        systemUsedPercent: number
    }
    api: {
        rpm: number
        rpm5: number
        successRate: number
        avgLatency: number
        tokensLastMinute: number
        tokensPerMinute: number
    }
    system: {
        uptime: number
        nodeVersion: string
        platform: string
        cpuCount: number
        loadAvg: number[]
    }
    timestamp: number
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (days > 0) return `${days}天 ${hours}小时`
    if (hours > 0) return `${hours}小时 ${minutes}分钟`
    return `${minutes}分钟`
}

function formatMemory(mb: number): string {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
    return `${mb} MB`
}

export function SystemMonitor({ className }: { className?: string }) {
    const [data, setData] = useState<MonitorData | null>(null)
    const [loading, setLoading] = useState(true)

    const fetchMonitor = async () => {
        try {
            const res = (await systemApi.getMonitor()) as { data?: MonitorData }
            if (res?.data) {
                setData(res.data)
            }
        } catch (error) {
            console.error('Failed to fetch monitor data:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchMonitor()
        // 每 10 秒刷新一次
        const interval = setInterval(fetchMonitor, 10000)
        return () => clearInterval(interval)
    }, [])

    if (loading || !data) {
        return (
            <Card className={cn('glass-card', className)}>
                <CardHeader className="border-b border-border/40 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500">
                            <Activity className="h-4 w-4" />
                        </div>
                        系统监控
                    </CardTitle>
                    <CardDescription>加载中...</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    const memoryLevel = data.memory.heapUsedPercent > 80 ? 'high' : data.memory.heapUsedPercent > 60 ? 'medium' : 'low'
    const rpmLevel = data.api.rpm > 30 ? 'high' : data.api.rpm > 10 ? 'medium' : 'low'

    return (
        <Card className={cn('glass-card hover:shadow-md transition-all duration-300', className)}>
            <CardHeader className="border-b border-border/40 pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                    <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500">
                        <Activity className="h-4 w-4" />
                    </div>
                    系统监控
                </CardTitle>
                <CardDescription className="mt-1">实时系统状态与 API 请求统计</CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
                {/* 内存使用 */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Database className="h-4 w-4 text-blue-500" />
                            堆内存
                        </div>
                        <span
                            className={cn(
                                'text-sm font-medium',
                                memoryLevel === 'high'
                                    ? 'text-red-500'
                                    : memoryLevel === 'medium'
                                      ? 'text-amber-500'
                                      : 'text-green-500'
                            )}
                        >
                            {formatMemory(data.memory.heapUsed)} / {formatMemory(data.memory.heapTotal)}
                        </span>
                    </div>
                    <Progress
                        value={data.memory.heapUsedPercent}
                        className={cn(
                            'h-2',
                            memoryLevel === 'high'
                                ? '[&>div]:bg-red-500'
                                : memoryLevel === 'medium'
                                  ? '[&>div]:bg-amber-500'
                                  : '[&>div]:bg-green-500'
                        )}
                    />
                </div>

                {/* API 指标 */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-muted/30 space-y-1">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Gauge className="h-3.5 w-3.5" />
                            <span className="text-xs">RPM</span>
                        </div>
                        <div
                            className={cn(
                                'text-2xl font-bold',
                                rpmLevel === 'high'
                                    ? 'text-red-500'
                                    : rpmLevel === 'medium'
                                      ? 'text-amber-500'
                                      : 'text-green-500'
                            )}
                        >
                            {data.api.rpm}
                        </div>
                        <div className="text-xs text-muted-foreground">5分钟平均: {data.api.rpm5}</div>
                    </div>

                    <div className="p-3 rounded-xl bg-muted/30 space-y-1">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Zap className="h-3.5 w-3.5" />
                            <span className="text-xs">成功率</span>
                        </div>
                        <div
                            className={cn(
                                'text-2xl font-bold',
                                data.api.successRate < 90
                                    ? 'text-red-500'
                                    : data.api.successRate < 98
                                      ? 'text-amber-500'
                                      : 'text-green-500'
                            )}
                        >
                            {data.api.successRate}%
                        </div>
                        <div className="text-xs text-muted-foreground">延迟: {data.api.avgLatency}ms</div>
                    </div>
                </div>

                {/* 系统信息 */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
                    <Badge variant="outline" className="bg-background/50">
                        <Clock className="h-3 w-3 mr-1" />
                        运行 {formatUptime(data.system.uptime)}
                    </Badge>
                    <Badge variant="outline" className="bg-background/50">
                        <Cpu className="h-3 w-3 mr-1" />
                        {data.system.cpuCount} 核心
                    </Badge>
                    <Badge variant="outline" className="bg-background/50">
                        RSS {formatMemory(data.memory.rss)}
                    </Badge>
                </div>
            </CardContent>
        </Card>
    )
}

// 简洁版监控卡片（用于侧边栏等小空间）
export function SystemMonitorCompact({ className }: { className?: string }) {
    const [data, setData] = useState<MonitorData | null>(null)

    useEffect(() => {
        const fetchMonitor = async () => {
            try {
                const res = (await systemApi.getMonitor()) as { data?: MonitorData }
                if (res?.data) setData(res.data)
            } catch {}
        }
        fetchMonitor()
        const interval = setInterval(fetchMonitor, 15000)
        return () => clearInterval(interval)
    }, [])

    if (!data) return null

    return (
        <div className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
            <div className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                <span>{data.memory.heapUsedPercent}%</span>
            </div>
            <div className="flex items-center gap-1">
                <Gauge className="h-3 w-3" />
                <span>{data.api.rpm} rpm</span>
            </div>
            <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{formatUptime(data.system.uptime)}</span>
            </div>
        </div>
    )
}
