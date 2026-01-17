'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
    AlertTriangle,
    Trash2,
    Loader2,
    Power,
    PowerOff,
    CheckCircle2,
    Info,
    HelpCircle,
    RefreshCw,
    Save,
    Send,
    Download,
    Upload,
    Settings,
    Shield,
    Zap
} from 'lucide-react'

// 操作类型配置
const actionVariants = {
    delete: {
        icon: Trash2,
        colors: {
            bg: 'from-red-500/20 to-red-600/20',
            bgInner: 'from-red-500/30 to-red-600/30',
            ping: 'bg-red-500',
            icon: 'text-red-500',
            button: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
            shadow: 'shadow-red-500/25 hover:shadow-red-500/40',
            badge: 'bg-red-500'
        },
        defaultTitle: '确认删除',
        defaultConfirmText: '确认删除',
        loadingText: '删除中...'
    },
    danger: {
        icon: AlertTriangle,
        colors: {
            bg: 'from-red-500/20 to-red-600/20',
            bgInner: 'from-red-500/30 to-red-600/30',
            ping: 'bg-red-500',
            icon: 'text-red-500',
            button: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
            shadow: 'shadow-red-500/25 hover:shadow-red-500/40',
            badge: 'bg-red-500'
        },
        defaultTitle: '危险操作',
        defaultConfirmText: '确认',
        loadingText: '处理中...'
    },
    warning: {
        icon: AlertTriangle,
        colors: {
            bg: 'from-amber-500/20 to-amber-600/20',
            bgInner: 'from-amber-500/30 to-amber-600/30',
            ping: 'bg-amber-500',
            icon: 'text-amber-500',
            button: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700',
            shadow: 'shadow-amber-500/25 hover:shadow-amber-500/40',
            badge: 'bg-amber-500'
        },
        defaultTitle: '警告',
        defaultConfirmText: '确认',
        loadingText: '处理中...'
    },
    enable: {
        icon: Power,
        colors: {
            bg: 'from-green-500/20 to-green-600/20',
            bgInner: 'from-green-500/30 to-green-600/30',
            ping: 'bg-green-500',
            icon: 'text-green-500',
            button: 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700',
            shadow: 'shadow-green-500/25 hover:shadow-green-500/40',
            badge: 'bg-green-500'
        },
        defaultTitle: '启用确认',
        defaultConfirmText: '确认启用',
        loadingText: '启用中...'
    },
    disable: {
        icon: PowerOff,
        colors: {
            bg: 'from-slate-500/20 to-slate-600/20',
            bgInner: 'from-slate-500/30 to-slate-600/30',
            ping: 'bg-slate-500',
            icon: 'text-slate-500',
            button: 'bg-gradient-to-r from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700',
            shadow: 'shadow-slate-500/25 hover:shadow-slate-500/40',
            badge: 'bg-slate-500'
        },
        defaultTitle: '禁用确认',
        defaultConfirmText: '确认禁用',
        loadingText: '禁用中...'
    },
    success: {
        icon: CheckCircle2,
        colors: {
            bg: 'from-emerald-500/20 to-emerald-600/20',
            bgInner: 'from-emerald-500/30 to-emerald-600/30',
            ping: 'bg-emerald-500',
            icon: 'text-emerald-500',
            button: 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700',
            shadow: 'shadow-emerald-500/25 hover:shadow-emerald-500/40',
            badge: 'bg-emerald-500'
        },
        defaultTitle: '操作确认',
        defaultConfirmText: '确认',
        loadingText: '处理中...'
    },
    info: {
        icon: Info,
        colors: {
            bg: 'from-blue-500/20 to-blue-600/20',
            bgInner: 'from-blue-500/30 to-blue-600/30',
            ping: 'bg-blue-500',
            icon: 'text-blue-500',
            button: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
            shadow: 'shadow-blue-500/25 hover:shadow-blue-500/40',
            badge: 'bg-blue-500'
        },
        defaultTitle: '信息',
        defaultConfirmText: '确认',
        loadingText: '处理中...'
    },
    question: {
        icon: HelpCircle,
        colors: {
            bg: 'from-violet-500/20 to-violet-600/20',
            bgInner: 'from-violet-500/30 to-violet-600/30',
            ping: 'bg-violet-500',
            icon: 'text-violet-500',
            button: 'bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700',
            shadow: 'shadow-violet-500/25 hover:shadow-violet-500/40',
            badge: 'bg-violet-500'
        },
        defaultTitle: '确认',
        defaultConfirmText: '确认',
        loadingText: '处理中...'
    },
    refresh: {
        icon: RefreshCw,
        colors: {
            bg: 'from-cyan-500/20 to-cyan-600/20',
            bgInner: 'from-cyan-500/30 to-cyan-600/30',
            ping: 'bg-cyan-500',
            icon: 'text-cyan-500',
            button: 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700',
            shadow: 'shadow-cyan-500/25 hover:shadow-cyan-500/40',
            badge: 'bg-cyan-500'
        },
        defaultTitle: '刷新确认',
        defaultConfirmText: '确认刷新',
        loadingText: '刷新中...'
    },
    save: {
        icon: Save,
        colors: {
            bg: 'from-indigo-500/20 to-indigo-600/20',
            bgInner: 'from-indigo-500/30 to-indigo-600/30',
            ping: 'bg-indigo-500',
            icon: 'text-indigo-500',
            button: 'bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700',
            shadow: 'shadow-indigo-500/25 hover:shadow-indigo-500/40',
            badge: 'bg-indigo-500'
        },
        defaultTitle: '保存确认',
        defaultConfirmText: '确认保存',
        loadingText: '保存中...'
    }
}

export type ActionVariant = keyof typeof actionVariants

// 通用确认对话框
interface ConfirmDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
    description?: string | React.ReactNode
    itemName?: string
    onConfirm: () => void | Promise<void>
    loading?: boolean
    variant?: ActionVariant
    confirmText?: string
    cancelText?: string
    showIcon?: boolean
}

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    itemName,
    onConfirm,
    loading = false,
    variant = 'question',
    confirmText,
    cancelText = '取消',
    showIcon = true
}: ConfirmDialogProps) {
    const [isProcessing, setIsProcessing] = React.useState(false)
    const config = actionVariants[variant]
    const IconComponent = config.icon

    const handleConfirm = async () => {
        setIsProcessing(true)
        try {
            await onConfirm()
            onOpenChange(false)
        } catch (error) {
            console.error('Action failed:', error)
        } finally {
            setIsProcessing(false)
        }
    }

    const isLoading = loading || isProcessing
    const finalTitle = title || config.defaultTitle
    const finalConfirmText = confirmText || config.defaultConfirmText

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent
                className={cn(
                    'sm:max-w-md overflow-hidden',
                    'bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl'
                )}
            >
                {showIcon && (
                    <div className="flex flex-col items-center pt-2 pb-4">
                        <div
                            className={cn(
                                'relative flex h-16 w-16 items-center justify-center rounded-full',
                                `bg-gradient-to-br ${config.colors.bg}`
                            )}
                        >
                            <div
                                className={cn(
                                    'absolute inset-0 rounded-full animate-ping opacity-20',
                                    config.colors.ping
                                )}
                                style={{ animationDuration: '2s' }}
                            />
                            <div
                                className={cn(
                                    'absolute inset-2 rounded-full',
                                    `bg-gradient-to-br ${config.colors.bgInner}`
                                )}
                            />
                            <IconComponent className={cn('h-7 w-7 relative z-10', config.colors.icon)} />
                        </div>
                    </div>
                )}

                <AlertDialogHeader className="text-center space-y-3">
                    <AlertDialogTitle className="text-xl font-semibold">{finalTitle}</AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground" asChild>
                        <div>
                            {description ||
                                (itemName ? (
                                    <>
                                        确定要操作 <span className="font-medium text-foreground">「{itemName}」</span>{' '}
                                        吗？
                                    </>
                                ) : (
                                    '确定要执行此操作吗？'
                                ))}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="mt-6 sm:flex-row gap-3">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                        className="flex-1 sm:flex-none"
                    >
                        {cancelText}
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={isLoading}
                        className={cn(
                            'flex-1 sm:flex-none gap-2',
                            config.colors.button,
                            `shadow-lg ${config.colors.shadow}`,
                            'transition-all duration-300 text-white'
                        )}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {config.loadingText}
                            </>
                        ) : (
                            <>
                                <IconComponent className="h-4 w-4" />
                                {finalConfirmText}
                            </>
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

// 删除对话框（兼容旧版本）
interface DeleteDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
    description?: string
    itemName?: string
    onConfirm: () => void | Promise<void>
    loading?: boolean
    variant?: 'default' | 'danger'
}

export function DeleteDialog({
    open,
    onOpenChange,
    title = '确认删除',
    description,
    itemName,
    onConfirm,
    loading = false,
    variant = 'danger'
}: DeleteDialogProps) {
    return (
        <ConfirmDialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            description={
                description ||
                (itemName ? (
                    <>
                        此操作不可撤销。
                        <br />
                        <span className="mt-2 inline-block">
                            确定要删除 <span className="font-medium text-foreground">「{itemName}」</span> 吗？
                        </span>
                    </>
                ) : (
                    '此操作不可撤销。确定要删除吗？'
                ))
            }
            onConfirm={onConfirm}
            loading={loading}
            variant={variant === 'danger' ? 'delete' : 'warning'}
            confirmText="确认删除"
        />
    )
}

// 批量操作对话框
interface BatchActionDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    count: number
    itemType?: string
    onConfirm: () => void | Promise<void>
    loading?: boolean
    variant?: ActionVariant
    title?: string
    actionText?: string
}

export function BatchActionDialog({
    open,
    onOpenChange,
    count,
    itemType = '项目',
    onConfirm,
    loading = false,
    variant = 'delete',
    title,
    actionText
}: BatchActionDialogProps) {
    const [isProcessing, setIsProcessing] = React.useState(false)
    const config = actionVariants[variant]
    const IconComponent = config.icon

    const handleConfirm = async () => {
        setIsProcessing(true)
        try {
            await onConfirm()
            onOpenChange(false)
        } catch (error) {
            console.error('Batch action failed:', error)
        } finally {
            setIsProcessing(false)
        }
    }

    const isLoading = loading || isProcessing
    const finalTitle = title || (variant === 'delete' ? '批量删除确认' : `批量${config.defaultTitle}`)
    const finalActionText = actionText || config.defaultConfirmText

    // 根据 variant 生成描述文本
    const getDescription = () => {
        const countSpan = <span className={cn('font-semibold', config.colors.icon)}>{count}</span>
        if (variant === 'delete') {
            return (
                <>
                    您即将删除 {countSpan} 个{itemType}。
                    <br />
                    <span className="text-destructive font-medium">此操作不可撤销！</span>
                </>
            )
        }
        if (variant === 'enable') {
            return (
                <>
                    您即将启用 {countSpan} 个{itemType}。
                </>
            )
        }
        if (variant === 'disable') {
            return (
                <>
                    您即将禁用 {countSpan} 个{itemType}。
                </>
            )
        }
        return (
            <>
                您即将操作 {countSpan} 个{itemType}。
            </>
        )
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent
                className={cn(
                    'sm:max-w-md overflow-hidden',
                    'bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl'
                )}
            >
                <div className="flex flex-col items-center pt-2 pb-4">
                    <div
                        className={cn(
                            'relative flex h-16 w-16 items-center justify-center rounded-full',
                            `bg-gradient-to-br ${config.colors.bg}`
                        )}
                    >
                        <div
                            className={cn('absolute inset-0 rounded-full animate-ping opacity-20', config.colors.ping)}
                            style={{ animationDuration: '2s' }}
                        />
                        <div
                            className={cn(
                                'absolute inset-2 rounded-full',
                                `bg-gradient-to-br ${config.colors.bgInner}`
                            )}
                        />
                        <IconComponent className={cn('h-7 w-7 relative z-10', config.colors.icon)} />
                    </div>
                    <div className="absolute top-14 right-[calc(50%-2rem)] transform translate-x-1/2">
                        <div
                            className={cn(
                                'flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold text-white shadow-lg',
                                config.colors.badge,
                                `shadow-${config.colors.badge}/50`
                            )}
                        >
                            {count}
                        </div>
                    </div>
                </div>

                <AlertDialogHeader className="text-center space-y-3">
                    <AlertDialogTitle className="text-xl font-semibold">{finalTitle}</AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground" asChild>
                        <div>{getDescription()}</div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="mt-6 sm:flex-row gap-3">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isLoading}
                        className="flex-1 sm:flex-none"
                    >
                        取消
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={isLoading}
                        className={cn(
                            'flex-1 sm:flex-none gap-2',
                            config.colors.button,
                            `shadow-lg ${config.colors.shadow}`,
                            'transition-all duration-300 text-white'
                        )}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {config.loadingText}
                            </>
                        ) : (
                            <>
                                <IconComponent className="h-4 w-4" />
                                {finalActionText} ({count})
                            </>
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

// 兼容旧版 BatchDeleteDialog
interface BatchDeleteDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    count: number
    itemType?: string
    onConfirm: () => void | Promise<void>
    loading?: boolean
}

export function BatchDeleteDialog(props: BatchDeleteDialogProps) {
    return <BatchActionDialog {...props} variant="delete" />
}
