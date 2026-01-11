import * as React from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: 'sm' | 'default' | 'lg'
    text?: string
}

function LoadingSpinner({ size = 'default', text, className, ...props }: LoadingSpinnerProps) {
    const sizeClasses = {
        sm: 'w-4 h-4',
        default: 'w-6 h-6',
        lg: 'w-8 h-8'
    }

    return (
        <div className={cn('flex flex-col items-center justify-center gap-3', className)} {...props}>
            <Loader2 className={cn('animate-spin text-primary', sizeClasses[size])} />
            {text && <p className="text-sm text-muted-foreground">{text}</p>}
        </div>
    )
}

interface LoadingOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
    text?: string
}

function LoadingOverlay({ text, className, ...props }: LoadingOverlayProps) {
    return (
        <div
            className={cn(
                'absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm',
                className
            )}
            {...props}
        >
            <LoadingSpinner size="lg" text={text} />
        </div>
    )
}

type LoadingDotsProps = React.HTMLAttributes<HTMLDivElement>

function LoadingDots({ className, ...props }: LoadingDotsProps) {
    return (
        <div className={cn('flex items-center gap-1', className)} {...props}>
            {[0, 1, 2].map(i => (
                <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-primary animate-bounce-soft"
                    style={{ animationDelay: `${i * 150}ms` }}
                />
            ))}
        </div>
    )
}

interface LoadingSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    rows?: number
    showAvatar?: boolean
}

const skeletonWidths = ['w-full', 'w-4/5', 'w-3/4', 'w-5/6', 'w-2/3']

function LoadingSkeleton({ rows = 3, showAvatar = false, className, ...props }: LoadingSkeletonProps) {
    return (
        <div className={cn('space-y-4', className)} {...props}>
            {showAvatar && (
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                    <div className="space-y-2 flex-1">
                        <div className="h-4 bg-muted rounded animate-pulse w-1/3" />
                        <div className="h-3 bg-muted rounded animate-pulse w-1/4" />
                    </div>
                </div>
            )}
            {Array.from({ length: rows }).map((_, i) => (
                <div
                    key={i}
                    className={cn('h-4 bg-muted rounded animate-pulse', skeletonWidths[i % skeletonWidths.length])}
                />
            ))}
        </div>
    )
}

interface PageLoadingProps {
    text?: string
}

function PageLoading({ text = '加载中...' }: PageLoadingProps) {
    return (
        <div className="flex h-[50vh] items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-4 border-muted" />
                    <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                </div>
                <p className="text-sm text-muted-foreground animate-pulse-soft">{text}</p>
            </div>
        </div>
    )
}

export { LoadingSpinner, LoadingOverlay, LoadingDots, LoadingSkeleton, PageLoading }
