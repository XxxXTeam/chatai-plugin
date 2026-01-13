'use client'

import { useSkillsSSE, SSEStatus } from '@/lib/hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Wifi, WifiOff, RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConnectionStatusProps {
    className?: string
    showDetails?: boolean
    onEvent?: (event: { event: string; data: Record<string, unknown> }) => void
}

const statusConfig: Record<SSEStatus, { icon: React.ReactNode; label: string; color: string; bgColor: string }> = {
    disconnected: {
        icon: <WifiOff className="h-3.5 w-3.5" />,
        label: '已断开',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted'
    },
    connecting: {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: '连接中',
        color: 'text-yellow-600 dark:text-yellow-400',
        bgColor: 'bg-yellow-100 dark:bg-yellow-900/30'
    },
    connected: {
        icon: <Wifi className="h-3.5 w-3.5" />,
        label: '实时连接',
        color: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-100 dark:bg-green-900/30'
    },
    reconnecting: {
        icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
        label: '重连中',
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-100 dark:bg-orange-900/30'
    },
    error: {
        icon: <AlertCircle className="h-3.5 w-3.5" />,
        label: '连接错误',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-100 dark:bg-red-900/30'
    }
}

export function ConnectionStatus({ className, showDetails = false, onEvent }: ConnectionStatusProps) {
    const { status, reconnectCount, connect, disconnect, lastEvent, isConnected } = useSkillsSSE({
        onEvent: onEvent ? event => onEvent({ event: event.event, data: event.data }) : undefined
    })

    const config = statusConfig[status]

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className={cn('flex items-center gap-2', className)}>
                        <Badge
                            variant="outline"
                            className={cn(
                                'flex items-center gap-1.5 px-2 py-0.5 font-normal transition-colors',
                                config.color,
                                config.bgColor
                            )}
                        >
                            {config.icon}
                            {showDetails && <span className="text-xs">{config.label}</span>}
                            {/* 连接指示点 */}
                            <span
                                className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    isConnected ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'
                                )}
                            />
                        </Badge>

                        {/* 重连按钮 */}
                        {(status === 'error' || status === 'disconnected') && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => connect()}>
                                <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                        <p className="font-medium">{config.label}</p>
                        {status === 'reconnecting' && (
                            <p className="text-muted-foreground">重连尝试: {reconnectCount}</p>
                        )}
                        {lastEvent && <p className="text-muted-foreground">最后事件: {lastEvent.event}</p>}
                        <p className="text-muted-foreground">
                            {isConnected ? '实时接收服务器状态更新' : '点击刷新按钮重新连接'}
                        </p>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

/**
 * 紧凑版连接状态指示器
 */
export function ConnectionDot({ className }: { className?: string }) {
    const { isConnected, status } = useSkillsSSE()

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            'inline-block h-2 w-2 rounded-full transition-colors',
                            isConnected
                                ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                                : status === 'connecting' || status === 'reconnecting'
                                  ? 'bg-yellow-500 animate-pulse'
                                  : 'bg-muted-foreground',
                            className
                        )}
                    />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    <span className="text-xs">{statusConfig[status].label}</span>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default ConnectionStatus
